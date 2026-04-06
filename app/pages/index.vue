<script setup lang="ts">
import type { EditorCustomHandlers, EditorToolbarItem } from "@nuxt/ui";
import Image, { type ImageOptions } from "@tiptap/extension-image";
import { mergeAttributes, ResizableNodeView, type Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { co } from "jazz-tools";
import { createImage, loadImageBySize } from "jazz-tools/media";
import { TextSelection } from "@tiptap/pm/state";
import { createInviteLink } from "jazz-tools/browser";
import { JazzSyncExtension } from "jazz-tools/tiptap";
import { useJazzDocument } from "~/composables/useJazzDocument";
import { useJazzReactiveState } from "~/composables/useJazzReactiveState";
import {
  CommentHighlightsExtension,
  updateCommentHighlights,
} from "~/lib/editor/comment-highlights";
import { CollaborativeDocument, CommentReplyItem } from "~/lib/jazz/schema";

type LoadedAccount = Awaited<ReturnType<typeof useJazzDocument>>;
type SharedDocument = NonNullable<LoadedAccount["document"]>;
type SharedComment = NonNullable<LoadedAccount["document"]["comments"][number]>;
type SharedReply = {
  authorLabel: string;
  body: string;
  createdAt: number;
};
type SharedOwner = SharedDocument["$jazz"]["owner"];
type CommentSelection = {
  blockIndex: number;
  blockText: string;
  blockAnchor: number;
  blockHead: number;
  anchor: number;
  head: number;
  quote: string;
};
type DerivedCommentState = {
  comment: SharedComment;
  range: {
    from: number;
    to: number;
  } | null;
  disconnected: boolean;
};
type ImageAlignment = "left" | "center" | "right";
type FocusableComment = {
  $jazz?: {
    id?: string;
  };
  blockIndex?: number;
  blockText?: string;
  blockAnchor?: number;
  blockHead?: number;
  anchor?: number;
  head?: number;
  quote?: string;
};
type TextBlockEntry = {
  index: number;
  pos: number;
  contentStart: number;
  contentEnd: number;
  text: string;
};
type MutableCommentState = {
  $jazz: {
    id?: string;
    set: (
      key: "resolvedAt" | "resolvedBy",
      value: number | string | undefined,
    ) => void;
    delete: (key: "resolvedAt" | "resolvedBy") => void;
  };
};
type ThreadCommentState = {
  $jazz?: {
    id?: string;
  };
  replies?: {
    $jazz?: {
      push: (reply: {
        authorLabel: SharedReply["authorLabel"];
        body: SharedReply["body"];
        createdAt: SharedReply["createdAt"];
      }) => void;
    };
  };
};
type CommentMutationTarget = {
  $jazz?: {
    id?: string;
    set?: (
      key: "resolvedAt" | "resolvedBy",
      value: number | string | undefined,
    ) => void;
    delete?: (key: "resolvedAt" | "resolvedBy") => void;
  };
  replies?: {
    $jazz?: {
      push?: (reply: SharedReply) => void;
    };
  };
} & Record<string, any>;
type BlockMetadataCommentState = {
  $jazz: {
    set: (
      key: "blockIndex" | "blockText" | "blockAnchor" | "blockHead",
      value: number | string,
    ) => void;
  };
};
type ReplyMetadataCommentState = {
  replies?: ReadonlyArray<
    Pick<SharedReply, "authorLabel" | "body" | "createdAt">
  >;
  $jazz: {
    set: (
      key: "replies",
      value: ReturnType<
        ReturnType<typeof co.list<typeof CommentReplyItem>>["create"]
      >,
    ) => void;
  };
};

const runtimeConfig = useRuntimeConfig();
const route = useRoute();
const router = useRouter();
const toast = useToast();

const collaborationState = shallowRef<LoadedAccount | null>(null);
const errorMessage = ref("");
const isLoading = ref(true);
const isCreatingDocument = ref(false);
const isCopyingInvite = ref(false);
const isUploadingImage = ref(false);
const isDevelopment = import.meta.dev;
const commentsOpen = ref(false);
const newComment = ref("");
const editorInstance = shallowRef<Editor | null>(null);
const editorRevision = ref(0);
const imageUploadInput = ref<HTMLInputElement | null>(null);
const activeSelection = ref<CommentSelection | null>(null);
const lastSelection = ref<CommentSelection | null>(null);
const draftCommentSelection = ref<CommentSelection | null>(null);
const isSelectionComposerOpen = ref(false);
const selectionBubbleStyle = ref<Record<string, string> | null>(null);
const activeCommentId = ref<string | null>(null);
const lastAppliedHighlightSignature = ref("");
const jazzImageObjectUrls = new Map<string, string>();
const jazzImagePendingLoads = new Map<string, Promise<void>>();

let detachNativeSelectionListeners: (() => void) | null = null;
const jazzImageSrcPrefix = "jazz-image:";

const sharedDoc = computed(() => collaborationState.value?.document ?? null);
const sharedDocumentId = computed(() => sharedDoc.value?.$jazz.id ?? null);
const isInviteDocument = computed(
  () => collaborationState.value?.isInviteDocument ?? false,
);
const usesFallbackKey = computed(() => !runtimeConfig.public.jazzApiKey);
const titleValue = useJazzReactiveState(sharedDoc, {
  fallback: "",
  getValue: (document) => document.title,
});
const commentAuthorLabel = computed(() => {
  const id = collaborationState.value?.account.$jazz.id;
  return id ? `User ${id.slice(-4)}` : "User";
});
const comments = useJazzReactiveState(sharedDoc, {
  fallback: [] as SharedComment[],
  subscribeOptions: {
    resolve: {
      comments: {
        $each: true,
      },
    },
  },
  getValue: (document) =>
    Array.from(document.comments.entries())
      .map(([, comment]) => comment)
      .filter((comment): comment is SharedComment => Boolean(comment)),
});
function normalizeCommentText(text: string | undefined) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function getJazzImageId(src: string | null | undefined) {
  if (!src?.startsWith(jazzImageSrcPrefix)) {
    return null;
  }

  const imageId = src.slice(jazzImageSrcPrefix.length);
  return imageId || null;
}

function getRouteDocumentId() {
  const documentParam = route.query.document;

  if (Array.isArray(documentParam)) {
    return documentParam[0]?.trim() || undefined;
  }

  return typeof documentParam === "string" && documentParam.trim()
    ? documentParam.trim()
    : undefined;
}

async function syncDocumentQuery(documentId: string) {
  if (getRouteDocumentId() === documentId) {
    return;
  }

  await router.replace({
    query: {
      ...route.query,
      document: documentId,
    },
  });
}

async function loadCollaborationState() {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    collaborationState.value = await useJazzDocument(getRouteDocumentId());

    const documentId = collaborationState.value.document.$jazz.id;

    if (documentId) {
      await syncDocumentQuery(documentId);
    }
  } catch (error) {
    collaborationState.value = null;
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "Failed to initialize the Jazz collaboration context.";
  } finally {
    isLoading.value = false;
  }
}

function resetUiForDocumentChange() {
  revokeJazzImageObjectUrls();
  activeCommentId.value = null;
  commentsOpen.value = false;
  activeSelection.value = null;
  lastSelection.value = null;
  draftCommentSelection.value = null;
  isSelectionComposerOpen.value = false;
  selectionBubbleStyle.value = null;
  newComment.value = "";
}

async function handleCreateDocument() {
  const state = collaborationState.value;

  if (!state) {
    return;
  }

  try {
    isCreatingDocument.value = true;

    const document = CollaborativeDocument.create(
      {
        title: "Untitled document",
        content: "<p></p>",
        images: [],
        presence: [],
        comments: [],
      },
      {
        owner: state.account.$jazz.owner,
      },
    );

    state.account.root.$jazz.set(
      "currentDocument",
      document as Parameters<typeof state.account.root.$jazz.set>[1],
    );

    await router.push({
      query: {
        ...route.query,
        document: document.$jazz.id,
      },
    });

    toast.add({
      title: "New document created",
      description: "You are now editing a fresh shared document.",
    });
  } catch (error) {
    toast.add({
      title: "Could not create document",
      description:
        error instanceof Error
          ? error.message
          : "Unable to create a new shared document.",
      color: "error",
    });
  } finally {
    isCreatingDocument.value = false;
  }
}

function scheduleJazzImageHydration(editor: Editor) {
  requestAnimationFrame(() => {
    void hydrateRenderedJazzImages(editor);
  });
}

async function hydrateRenderedJazzImages(editor: Editor) {
  const images = Array.from(
    editor.view.dom.querySelectorAll<HTMLImageElement>("img"),
  );

  await Promise.all(
    images.map(async (imageElement) => {
      const marker = imageElement.getAttribute("src");
      const imageId = getJazzImageId(marker);

      if (!marker || !imageId) {
        return;
      }

      const cachedObjectUrl = jazzImageObjectUrls.get(imageId);

      if (cachedObjectUrl) {
        imageElement.src = cachedObjectUrl;
        return;
      }

      const pendingLoad = jazzImagePendingLoads.get(imageId);

      if (pendingLoad) {
        await pendingLoad;
        const loadedObjectUrl = jazzImageObjectUrls.get(imageId);

        if (loadedObjectUrl && imageElement.isConnected) {
          imageElement.src = loadedObjectUrl;
        }
        return;
      }

      const loadPromise = (async () => {
        const width = Math.max(
          512,
          Math.round(imageElement.getBoundingClientRect().width || 1024),
        );
        const loadedImage = await loadImageBySize(imageId, width, width);
        const blob = loadedImage?.image.toBlob();

        if (!blob) {
          return;
        }

        const existingObjectUrl = jazzImageObjectUrls.get(imageId);

        if (existingObjectUrl) {
          URL.revokeObjectURL(existingObjectUrl);
        }

        jazzImageObjectUrls.set(imageId, URL.createObjectURL(blob));
      })().finally(() => {
        jazzImagePendingLoads.delete(imageId);
      });

      jazzImagePendingLoads.set(imageId, loadPromise);
      await loadPromise;

      const loadedObjectUrl = jazzImageObjectUrls.get(imageId);

      if (loadedObjectUrl && imageElement.isConnected) {
        imageElement.src = loadedObjectUrl;
      }
    }),
  );
}

function revokeJazzImageObjectUrls() {
  for (const objectUrl of jazzImageObjectUrls.values()) {
    URL.revokeObjectURL(objectUrl);
  }

  jazzImageObjectUrls.clear();
  jazzImagePendingLoads.clear();
}

function createReplyList(
  owner: SharedOwner,
  replies: ReadonlyArray<
    Pick<SharedReply, "authorLabel" | "body" | "createdAt">
  > = [],
) {
  const replyList = co.list(CommentReplyItem).create([], owner);

  for (const reply of replies) {
    replyList.$jazz.push({
      authorLabel: reply.authorLabel,
      body: reply.body,
      createdAt: reply.createdAt,
    });
  }

  return replyList;
}

function getTextBlocks(editor: Editor) {
  const blocks: TextBlockEntry[] = [];
  let index = 0;

  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) {
      return true;
    }

    blocks.push({
      index,
      pos,
      contentStart: pos + 1,
      contentEnd: pos + node.content.size + 1,
      text: node.textContent,
    });
    index += 1;

    return true;
  });

  return blocks;
}

function buildBlockRange(block: TextBlockEntry, anchor: number, head: number) {
  const maxOffset = Math.max(0, block.contentEnd - block.contentStart);
  const safeAnchor = Math.min(Math.max(0, anchor), maxOffset);
  const safeHead = Math.min(Math.max(0, head), maxOffset);
  const from = block.contentStart + Math.min(safeAnchor, safeHead);
  const to = block.contentStart + Math.max(safeAnchor, safeHead);

  if (from === to) {
    return null;
  }

  return { from, to };
}

function rangeMatchesQuote(
  editor: Editor,
  range: { from: number; to: number },
  quote: string | undefined,
) {
  if (!quote) {
    return true;
  }

  const currentText = editor.state.doc.textBetween(range.from, range.to, " ");
  return normalizeCommentText(currentText) === normalizeCommentText(quote);
}

function resolveCommentRange(editor: Editor | null, comment: FocusableComment) {
  if (!editor) {
    return {
      range: null,
      disconnected: false,
    };
  }

  if (
    typeof comment.blockAnchor === "number" &&
    typeof comment.blockHead === "number" &&
    (typeof comment.blockIndex === "number" ||
      typeof comment.blockText === "string")
  ) {
    const blocks = getTextBlocks(editor);
    const hintedBlock =
      typeof comment.blockIndex === "number"
        ? blocks[comment.blockIndex]
        : null;
    const candidateBlocks = [
      ...(hintedBlock ? [hintedBlock] : []),
      ...blocks.filter((block) => {
        if (block === hintedBlock) {
          return false;
        }

        return typeof comment.blockText === "string"
          ? block.text === comment.blockText
          : false;
      }),
    ];

    for (const block of candidateBlocks) {
      const range = buildBlockRange(
        block,
        comment.blockAnchor,
        comment.blockHead,
      );

      if (!range) {
        continue;
      }

      if (rangeMatchesQuote(editor, range, comment.quote)) {
        return {
          range,
          disconnected: false,
        };
      }
    }

    const fallbackRange = hintedBlock
      ? buildBlockRange(hintedBlock, comment.blockAnchor, comment.blockHead)
      : null;

    return {
      range: fallbackRange,
      disconnected: true,
    };
  }

  if (typeof comment.anchor !== "number" || typeof comment.head !== "number") {
    return {
      range: null,
      disconnected: Boolean(comment.quote),
    };
  }

  const max = Math.max(1, editor.state.doc.content.size);
  const from = Math.min(
    Math.max(1, Math.min(comment.anchor, comment.head)),
    max,
  );
  const to = Math.min(
    Math.max(from, Math.max(comment.anchor, comment.head)),
    max,
  );

  return {
    range: { from, to },
    disconnected: !rangeMatchesQuote(editor, { from, to }, comment.quote),
  };
}

const derivedComments = computed<DerivedCommentState[]>(() => {
  void editorRevision.value;

  return comments.value.map((comment) => {
    const { range, disconnected } = resolveCommentRange(
      editorInstance.value,
      comment,
    );

    return {
      comment,
      range,
      disconnected,
    };
  });
});
const disconnectedComments = computed(() =>
  derivedComments.value
    .filter(({ disconnected }) => disconnected)
    .map(({ comment }) => comment),
);
const connectedOpenCommentStates = computed(() =>
  derivedComments.value.filter(
    ({ comment, disconnected, range }) =>
      !comment.resolvedAt && !disconnected && Boolean(range),
  ),
);
const connectedOpenComments = computed(() =>
  connectedOpenCommentStates.value.map(({ comment }) => comment),
);
const connectedResolvedCommentStates = computed(() =>
  derivedComments.value.filter(
    ({ comment, disconnected, range }) =>
      Boolean(comment.resolvedAt) && !disconnected && Boolean(range),
  ),
);
const connectedResolvedComments = computed(() =>
  connectedResolvedCommentStates.value.map(({ comment }) => comment),
);
const floatingOpenComments = computed(
  () => connectedOpenComments.value as unknown as any[],
);
const floatingResolvedComments = computed(
  () => connectedResolvedComments.value as unknown as any[],
);
const floatingDisconnectedComments = computed(
  () => disconnectedComments.value as unknown as any[],
);
const commentHighlights = computed(() => [
  ...connectedOpenCommentStates.value.map(({ comment, range }) => ({
    id: comment.$jazz.id,
    anchor: range?.from,
    head: range?.to,
    active: comment.$jazz.id === activeCommentId.value,
  })),
  ...(isSelectionComposerOpen.value && draftCommentSelection.value
    ? [
        {
          id: "__draft__",
          anchor: draftCommentSelection.value.anchor,
          head: draftCommentSelection.value.head,
          active: true,
          draft: true,
        },
      ]
    : []),
]);
const unresolvedCommentsCount = computed(
  () => comments.value.filter((comment) => !comment.resolvedAt).length,
);
const resolvedCommentsCount = computed(
  () => comments.value.filter((comment) => Boolean(comment.resolvedAt)).length,
);
const hasUnresolvedComments = computed(() => unresolvedCommentsCount.value > 0);

function syncImageElementAttributes(
  element: HTMLImageElement,
  attributes: Record<string, unknown>,
  options: {
    includeSrc?: boolean;
  } = {},
) {
  const { includeSrc = true } = options;

  for (const name of Array.from(element.getAttributeNames())) {
    if (name === "style") {
      continue;
    }

    if (name === "src" && !includeSrc) {
      continue;
    }

    if (!(name in attributes)) {
      element.removeAttribute(name);
    }
  }

  for (const [key, value] of Object.entries(attributes)) {
    if (key === "width" || key === "height") {
      if (value == null || value === "") {
        element.style.removeProperty(key);
      } else {
        element.style.setProperty(
          key,
          typeof value === "number" ? `${value}px` : String(value),
        );
      }
      continue;
    }

    if (key === "src") {
      if (includeSrc && typeof value === "string") {
        element.setAttribute("src", value);
      }
      continue;
    }

    if (value == null || value === false || value === "") {
      element.removeAttribute(key);
      continue;
    }

    element.setAttribute(key, String(value));
  }
}

const CollaborativeImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      imageAlign: {
        default: "center",
        parseHTML: (element) =>
          element.getAttribute("data-image-align") || "center",
        renderHTML: (attributes) => ({
          "data-image-align":
            typeof attributes.imageAlign === "string"
              ? attributes.imageAlign
              : "center",
        }),
      },
    };
  },
  addNodeView() {
    if (
      !this.options.resize ||
      !this.options.resize.enabled ||
      typeof document === "undefined"
    ) {
      return null;
    }

    const { directions, minWidth, minHeight, alwaysPreserveAspectRatio } =
      this.options.resize;

    return ({ node, getPos, HTMLAttributes, editor }) => {
      const element = document.createElement("img");
      let currentNode = node;

      syncImageElementAttributes(
        element,
        mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      );

      const nodeView = new ResizableNodeView({
        element,
        editor,
        node,
        getPos,
        onResize: (width, height) => {
          element.style.width = `${width}px`;
          element.style.height = `${height}px`;
        },
        onCommit: (width, height) => {
          const pos = getPos();

          if (pos === undefined) {
            return;
          }

          this.editor
            .chain()
            .setNodeSelection(pos)
            .updateAttributes(this.name, {
              width,
              height,
            })
            .run();
        },
        onUpdate: (updatedNode) => {
          if (updatedNode.type !== currentNode.type) {
            return false;
          }

          syncImageElementAttributes(
            element,
            mergeAttributes(this.options.HTMLAttributes, updatedNode.attrs),
            {
              includeSrc: updatedNode.attrs.src !== currentNode.attrs.src,
            },
          );
          currentNode = updatedNode;

          return true;
        },
        options: {
          directions,
          min: {
            width: minWidth,
            height: minHeight,
          },
          preserveAspectRatio: alwaysPreserveAspectRatio === true,
        },
      });

      const dom = nodeView.dom;
      dom.style.visibility = "hidden";
      dom.style.pointerEvents = "none";

      element.onload = () => {
        dom.style.visibility = "";
        dom.style.pointerEvents = "";
      };

      return nodeView;
    };
  },
});
const editorImageOptions: Partial<ImageOptions> = {
  HTMLAttributes: {
    class: "editor-image",
  },
  resize: {
    enabled: true,
    directions: ["bottom-right", "bottom-left", "top-right", "top-left"],
    minWidth: 160,
    minHeight: 120,
    alwaysPreserveAspectRatio: true,
  },
};
const customHandlers = {
  imageAlign: {
    canExecute: (editor: Editor) => editor.isActive("image"),
    execute: (editor: Editor, item?: { align?: ImageAlignment }) =>
      editor
        .chain()
        .focus()
        .updateAttributes("image", {
          imageAlign: item?.align ?? "center",
        }),
    isActive: (editor: Editor, item?: { align?: ImageAlignment }) =>
      editor.isActive("image", { imageAlign: item?.align ?? "center" }),
    isDisabled: (editor: Editor) => !editor.isActive("image"),
  },
  removeImage: {
    canExecute: (editor: Editor) =>
      editor.isActive("image") && editor.can().deleteSelection(),
    execute: (editor: Editor) => editor.chain().focus().deleteSelection(),
    isActive: () => false,
    isDisabled: (editor: Editor) => !editor.isActive("image"),
  },
} satisfies EditorCustomHandlers;

const toolbar = [
  [
    {
      kind: "mark",
      mark: "bold",
      icon: "i-lucide-bold",
      tooltip: { text: "Bold" },
    },
    {
      kind: "mark",
      mark: "italic",
      icon: "i-lucide-italic",
      tooltip: { text: "Italic" },
    },
    {
      kind: "mark",
      mark: "strike",
      icon: "i-lucide-strikethrough",
      tooltip: { text: "Strike" },
    },
  ],
  [
    {
      kind: "heading",
      level: 1,
      icon: "i-lucide-heading-1",
      tooltip: { text: "Heading 1" },
    },
    {
      kind: "heading",
      level: 2,
      icon: "i-lucide-heading-2",
      tooltip: { text: "Heading 2" },
    },
    {
      kind: "bulletList",
      icon: "i-lucide-list",
      tooltip: { text: "Bullet list" },
    },
    {
      kind: "orderedList",
      icon: "i-lucide-list-ordered",
      tooltip: { text: "Ordered list" },
    },
    { kind: "blockquote", icon: "i-lucide-quote", tooltip: { text: "Quote" } },
  ],
  [
    { kind: "undo", icon: "i-lucide-undo-2", tooltip: { text: "Undo" } },
    { kind: "redo", icon: "i-lucide-redo-2", tooltip: { text: "Redo" } },
  ],
];
const bubbleToolbarItems = computed<EditorToolbarItem[][]>(() => [
  [
    {
      kind: "mark",
      mark: "bold",
      icon: "i-lucide-bold",
      tooltip: { text: "Bold" },
    },
    {
      kind: "mark",
      mark: "italic",
      icon: "i-lucide-italic",
      tooltip: { text: "Italic" },
    },
    {
      kind: "link",
      icon: "i-lucide-link",
      tooltip: { text: "Link" },
    },
    {
      icon: "i-lucide-message-square-plus",
      tooltip: { text: "Comment selection" },
      "aria-label": "Comment selection",
      onClick: () => {
        openSelectionComposer();
      },
    },
  ],
]);
const imageBubbleToolbarItems = computed<
  EditorToolbarItem<typeof customHandlers>[][]
>(() => [
  [
    {
      kind: "imageAlign",
      align: "left",
      icon: "i-lucide-align-left",
      tooltip: { text: "Align image left" },
    },
    {
      kind: "imageAlign",
      align: "center",
      icon: "i-lucide-align-center",
      tooltip: { text: "Center image" },
    },
    {
      kind: "imageAlign",
      align: "right",
      icon: "i-lucide-align-right",
      tooltip: { text: "Align image right" },
    },
    {
      kind: "removeImage",
      icon: "i-lucide-trash-2",
      color: "error",
      tooltip: { text: "Remove image" },
    },
  ],
]);

const suggestionItems = [
  {
    kind: "heading",
    level: 1,
    label: "Heading 1",
    description: "Large section heading",
    icon: "i-lucide-heading-1",
  },
  {
    kind: "heading",
    level: 2,
    label: "Heading 2",
    description: "Secondary section heading",
    icon: "i-lucide-heading-2",
  },
  {
    kind: "bulletList",
    label: "Bullet list",
    description: "Create an unordered list",
    icon: "i-lucide-list",
  },
  {
    kind: "orderedList",
    label: "Ordered list",
    description: "Create a numbered list",
    icon: "i-lucide-list-ordered",
  },
  {
    kind: "blockquote",
    label: "Quote",
    description: "Highlight quoted text",
    icon: "i-lucide-quote",
  },
  {
    kind: "codeBlock",
    label: "Code block",
    description: "Insert a formatted code block",
    icon: "i-lucide-code-2",
  },
  {
    kind: "image",
    label: "Image",
    description: "Upload an image into the shared document",
    icon: "i-lucide-image-up",
  },
];

const editorExtensions = computed(() => {
  if (!sharedDoc.value) {
    return [];
  }

  return [
    CollaborativeImage.configure(editorImageOptions),
    CommentHighlightsExtension,
    JazzSyncExtension.configure({
      coRichText: sharedDoc.value.content,
      config: {
        showDecorations: false,
      },
    }),
  ];
});

function handleTitleInput(event: Event) {
  const value = (event.target as HTMLInputElement).value;

  titleValue.value = value;

  if (!sharedDoc.value || sharedDoc.value.title === value) {
    return;
  }

  sharedDoc.value.$jazz.set("title", value);
}

async function handleCopyInviteLink() {
  if (!sharedDoc.value) {
    return;
  }

  try {
    isCopyingInvite.value = true;

    const inviteLink = createInviteLink(sharedDoc.value, "writer", {
      valueHint: "nuxt-ui-jazz-demo",
    });
    await navigator.clipboard.writeText(inviteLink);

    toast.add({
      title: "Writer link copied",
      description:
        "Open another browser window and paste the link there to join the same shared document.",
    });
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "Unable to copy the invite link.";
  } finally {
    isCopyingInvite.value = false;
  }
}

function openImagePicker() {
  imageUploadInput.value?.click();
}

async function handleImageUpload(editor: Editor, event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  input.value = "";

  if (!file) {
    return;
  }

  if (!file.type.startsWith("image/")) {
    toast.add({
      title: "Unsupported file",
      description: "Select an image file to insert it into the document.",
      color: "error",
    });
    return;
  }

  if (file.size > 4 * 1024 * 1024) {
    toast.add({
      title: "Image is too large",
      description:
        "Choose an image smaller than 4 MB for this shared demo document.",
      color: "error",
    });
    return;
  }

  try {
    isUploadingImage.value = true;

    if (!sharedDoc.value) {
      throw new Error("Shared document is not available yet.");
    }

    const image = await createImage(file, {
      owner: sharedDoc.value.$jazz.owner,
      maxSize: 1600,
      progressive: true,
      placeholder: "blur",
    });

    sharedDoc.value.images.$jazz.push(image);

    editor
      .chain()
      .focus()
      .setImage({
        src: `${jazzImageSrcPrefix}${image.$jazz.id}`,
        alt: file.name,
        title: file.name,
      })
      .run();

    scheduleJazzImageHydration(editor);

    toast.add({
      title: "Image inserted",
      description: "The image is now part of the shared Jazz document.",
    });
  } catch (error) {
    toast.add({
      title: "Upload failed",
      description:
        error instanceof Error
          ? error.message
          : "Unable to insert the selected image.",
      color: "error",
    });
  } finally {
    isUploadingImage.value = false;
  }
}

function syncActiveSelection(editor: Editor) {
  const { from, to, empty } = editor.state.selection;

  if (empty || from === to) {
    activeSelection.value = null;
    if (!isSelectionComposerOpen.value) {
      selectionBubbleStyle.value = null;
    }
    return;
  }

  const resolvedFrom = editor.state.doc.resolve(from);
  const resolvedTo = editor.state.doc.resolve(to);

  if (
    !resolvedFrom.sameParent(resolvedTo) ||
    !resolvedFrom.parent.isTextblock
  ) {
    activeSelection.value = null;
    if (!isSelectionComposerOpen.value) {
      selectionBubbleStyle.value = null;
    }
    return;
  }

  const blockPos = resolvedFrom.start(resolvedFrom.depth) - 1;
  const block = getTextBlocks(editor).find(
    (candidate) => candidate.pos === blockPos,
  );

  if (!block) {
    activeSelection.value = null;
    if (!isSelectionComposerOpen.value) {
      selectionBubbleStyle.value = null;
    }
    return;
  }

  activeSelection.value = {
    blockIndex: block.index,
    blockText: block.text,
    blockAnchor: from - block.contentStart,
    blockHead: to - block.contentStart,
    anchor: from,
    head: to,
    quote: editor.state.doc.textBetween(from, to, " ").trim(),
  };
  lastSelection.value = activeSelection.value;
  updateSelectionBubblePosition(editor, from, to);
}

function backfillCommentReplies() {
  if (!sharedDoc.value) {
    return;
  }

  for (const comment of comments.value) {
    if (comment.replies && "$jazz" in comment.replies) {
      continue;
    }

    const commentState = comment as SharedComment & ReplyMetadataCommentState;
    commentState.$jazz.set(
      "replies",
      createReplyList(sharedDoc.value.$jazz.owner, comment.replies ?? []),
    );
  }
}

function backfillCommentBlockMetadata(editor: Editor) {
  for (const comment of comments.value) {
    if (
      typeof comment.blockIndex === "number" &&
      typeof comment.blockText === "string" &&
      typeof comment.blockAnchor === "number" &&
      typeof comment.blockHead === "number"
    ) {
      continue;
    }

    if (
      typeof comment.anchor !== "number" ||
      typeof comment.head !== "number"
    ) {
      continue;
    }

    const max = Math.max(1, editor.state.doc.content.size);
    const from = Math.min(
      Math.max(1, Math.min(comment.anchor, comment.head)),
      max,
    );
    const to = Math.min(
      Math.max(from, Math.max(comment.anchor, comment.head)),
      max,
    );
    const resolvedFrom = editor.state.doc.resolve(from);
    const resolvedTo = editor.state.doc.resolve(to);

    if (
      !resolvedFrom.sameParent(resolvedTo) ||
      !resolvedFrom.parent.isTextblock
    ) {
      continue;
    }

    const blockPos = resolvedFrom.start(resolvedFrom.depth) - 1;
    const block = getTextBlocks(editor).find(
      (candidate) => candidate.pos === blockPos,
    );

    if (!block) {
      continue;
    }

    const commentState = comment as SharedComment & BlockMetadataCommentState;
    commentState.$jazz.set("blockIndex", block.index);
    commentState.$jazz.set("blockText", block.text);
    commentState.$jazz.set("blockAnchor", from - block.contentStart);
    commentState.$jazz.set("blockHead", to - block.contentStart);
  }
}

function updateSelectionBubblePosition(
  editor: Editor,
  from: number,
  to: number,
) {
  const nativeSelection = window.getSelection();
  const rangeRect =
    nativeSelection && nativeSelection.rangeCount > 0
      ? nativeSelection.getRangeAt(0).getBoundingClientRect()
      : null;
  const endCoords = editor.view.coordsAtPos(to);
  const sourceRect =
    rangeRect && rangeRect.width + rangeRect.height > 0
      ? rangeRect
      : {
          left: endCoords.left,
          right: endCoords.right,
          bottom: endCoords.bottom,
        };
  const viewportWidth = window.innerWidth;
  const bubbleWidth = isSelectionComposerOpen.value ? 384 : 112;
  const left = Math.min(
    Math.max(
      sourceRect.left +
        (sourceRect.right - sourceRect.left) / 2 -
        bubbleWidth / 2,
      16,
    ),
    viewportWidth - bubbleWidth - 16,
  );
  const top = sourceRect.bottom + 10;

  selectionBubbleStyle.value = {
    left: `${left}px`,
    top: `${top}px`,
  };
}

function refreshSelectionBubblePosition() {
  const editor = editorInstance.value;
  const selection = draftCommentSelection.value ?? activeSelection.value;

  if (!editor || !selection) {
    return;
  }

  updateSelectionBubblePosition(editor, selection.anchor, selection.head);
}

function shouldShowCommentBubble({
  view,
  state,
  from,
  to,
}: {
  view: EditorView;
  state: EditorState;
  from: number;
  to: number;
}) {
  const text = state.doc.textBetween(from, to, " ").trim();
  const resolvedFrom = state.doc.resolve(from);
  const resolvedTo = state.doc.resolve(to);
  const isSingleTextBlock =
    resolvedFrom.sameParent(resolvedTo) && resolvedFrom.parent.isTextblock;

  return (
    view.hasFocus() &&
    from !== to &&
    isSingleTextBlock &&
    Boolean(text) &&
    !isSelectionComposerOpen.value
  );
}

function shouldShowImageBubble({
  view,
  editor,
}: {
  view: EditorView;
  editor: Editor;
}) {
  return view.hasFocus() && editor.isActive("image");
}

function applyCommentHighlights(editor: Editor) {
  const signature = JSON.stringify(
    commentHighlights.value.map((comment) => [
      comment.id ?? "",
      comment.anchor ?? null,
      comment.head ?? null,
      Boolean(comment.active),
    ]),
  );

  if (signature === lastAppliedHighlightSignature.value) {
    return;
  }

  lastAppliedHighlightSignature.value = signature;
  updateCommentHighlights(editor, commentHighlights.value);
}

function bindNativeSelectionListeners(editor: Editor) {
  detachNativeSelectionListeners?.();

  const syncSelection = () => {
    requestAnimationFrame(() => {
      syncActiveSelection(editor);
    });
  };
  const handleClick = (event: MouseEvent) => {
    const clickPosition = editor.view.posAtCoords({
      left: event.clientX,
      top: event.clientY,
    })?.pos;
    const clickedCommentState =
      clickPosition === undefined
        ? null
        : derivedComments.value
            .filter(
              ({ disconnected, range }) => !disconnected && Boolean(range),
            )
            .sort((left, right) => {
              const leftSize = (left.range?.to ?? 0) - (left.range?.from ?? 0);
              const rightSize =
                (right.range?.to ?? 0) - (right.range?.from ?? 0);
              return leftSize - rightSize;
            })
            .find(({ range }) =>
              Boolean(
                range &&
                clickPosition >= range.from &&
                clickPosition <= range.to,
              ),
            );

    if (!clickedCommentState) {
      return;
    }

    const { comment } = clickedCommentState;
    activeCommentId.value = comment.$jazz.id;

    if (!hasUnresolvedComments.value || comment.resolvedAt) {
      commentsOpen.value = true;
    }

    handleFocusComment(comment);
  };

  editor.view.dom.addEventListener("mouseup", syncSelection);
  editor.view.dom.addEventListener("keyup", syncSelection);
  editor.view.dom.addEventListener("click", handleClick);

  detachNativeSelectionListeners = () => {
    editor.view.dom.removeEventListener("mouseup", syncSelection);
    editor.view.dom.removeEventListener("keyup", syncSelection);
    editor.view.dom.removeEventListener("click", handleClick);
  };
}

function handleDocumentSelectionChange() {
  const editor = editorInstance.value;

  if (!editor) {
    return;
  }

  const selection = window.getSelection();
  const anchorNode = selection?.anchorNode;
  const isInsideEditor = Boolean(
    anchorNode && editor.view.dom.contains(anchorNode),
  );

  if (!isInsideEditor) {
    if (!isSelectionComposerOpen.value) {
      activeSelection.value = null;
      selectionBubbleStyle.value = null;
    }
    return;
  }

  syncActiveSelection(editor);
}

function openSelectionComposer() {
  const selection = activeSelection.value ?? lastSelection.value;

  if (!selection) {
    return;
  }

  commentsOpen.value = false;
  draftCommentSelection.value = { ...selection };
  isSelectionComposerOpen.value = true;

  if (editorInstance.value) {
    updateSelectionBubblePosition(
      editorInstance.value,
      selection.anchor,
      selection.head,
    );
  }
}

function closeSelectionComposer() {
  isSelectionComposerOpen.value = false;
  draftCommentSelection.value = null;
  newComment.value = "";

  if (!activeSelection.value) {
    selectionBubbleStyle.value = null;
  }
}

function handleEditorCreate({ editor }: { editor: Editor }) {
  editorInstance.value = editor;
  editorRevision.value += 1;
  backfillCommentReplies();
  backfillCommentBlockMetadata(editor);
  bindNativeSelectionListeners(editor);
  syncActiveSelection(editor);
  applyCommentHighlights(editor);
  scheduleJazzImageHydration(editor);
}

function handleSelectionUpdate({ editor }: { editor: Editor }) {
  editorInstance.value = editor;
  syncActiveSelection(editor);
}

function handleEditorTransaction({
  editor,
  transaction,
}: {
  editor: Editor;
  transaction: { docChanged?: boolean };
}) {
  editorInstance.value = editor;
  if (transaction.docChanged) {
    editorRevision.value += 1;
  }
  syncActiveSelection(editor);
  scheduleJazzImageHydration(editor);
}

async function handleAddComment() {
  const body = newComment.value.trim();
  const selection = draftCommentSelection.value ?? activeSelection.value;

  if (!sharedDoc.value || !body || !selection) {
    return;
  }

  sharedDoc.value.comments.$jazz.push({
    authorLabel: commentAuthorLabel.value,
    body,
    createdAt: Date.now(),
    blockIndex: selection.blockIndex,
    blockText: selection.blockText,
    blockAnchor: selection.blockAnchor,
    blockHead: selection.blockHead,
    anchor: selection.anchor,
    head: selection.head,
    quote: selection.quote,
    replies: createReplyList(sharedDoc.value.$jazz.owner),
  });

  newComment.value = "";
  closeSelectionComposer();
}

function handleAddReply(comment: any, body: string) {
  const rawComment = toRaw(comment) as CommentMutationTarget;
  const trimmedBody = body.trim();

  if (!trimmedBody || !rawComment.replies?.$jazz?.push) {
    return;
  }

  rawComment.replies.$jazz.push({
    authorLabel: commentAuthorLabel.value,
    body: trimmedBody,
    createdAt: Date.now(),
  });

  activeCommentId.value = rawComment.$jazz?.id ?? activeCommentId.value;
}

function handleClearAllComments() {
  if (!sharedDoc.value || comments.value.length === 0) {
    return;
  }

  const confirmed = window.confirm(
    "Delete all comments from this shared document?",
  );

  if (!confirmed) {
    return;
  }

  sharedDoc.value.comments.$jazz.splice(0, sharedDoc.value.comments.length);

  toast.add({
    title: "Comments cleared",
    description: "Removed every comment from the shared document.",
  });
}

function handleFocusComment(comment: FocusableComment) {
  const editor = editorInstance.value;

  if (comment.$jazz?.id) {
    activeCommentId.value = comment.$jazz.id;
  }

  if (!editor) {
    return;
  }

  const { range } = resolveCommentRange(editor, comment);

  if (!range) {
    return;
  }

  editor.commands.focus();
  editor.view.dispatch(
    editor.state.tr
      .setSelection(
        TextSelection.create(editor.state.doc, range.from, range.to),
      )
      .scrollIntoView(),
  );
  syncActiveSelection(editor);
}

function handleResolveComment(comment: any) {
  const rawComment = toRaw(comment) as CommentMutationTarget;

  if (rawComment.$jazz?.id === activeCommentId.value) {
    activeCommentId.value = null;
  }

  rawComment.$jazz?.set?.("resolvedAt", Date.now());
  rawComment.$jazz?.set?.("resolvedBy", commentAuthorLabel.value);
}

function handleReopenComment(comment: any) {
  const rawComment = toRaw(comment) as CommentMutationTarget;

  rawComment.$jazz?.delete?.("resolvedAt");
  rawComment.$jazz?.delete?.("resolvedBy");

  if (rawComment.$jazz?.id) {
    activeCommentId.value = rawComment.$jazz.id;
  }
}

watch(
  [editorInstance, commentHighlights],
  ([editor]) => {
    if (!editor) {
      return;
    }

    applyCommentHighlights(editor);
  },
  {
    immediate: true,
    deep: true,
  },
);

watch(
  [editorInstance, comments],
  ([editor]) => {
    backfillCommentReplies();

    if (!editor) {
      return;
    }

    backfillCommentBlockMetadata(editor);
  },
  {
    immediate: true,
    deep: true,
  },
);

watch(
  () => route.query.document,
  async () => {
    if (!import.meta.client) {
      return;
    }

    const routeDocumentId = getRouteDocumentId();

    if (routeDocumentId === sharedDocumentId.value) {
      return;
    }

    resetUiForDocumentChange();
    await loadCollaborationState();
  },
);

watch(activeSelection, (selection) => {
  if (selection && !isSelectionComposerOpen.value) {
    draftCommentSelection.value = null;
  }
});

watch(
  comments,
  (nextComments) => {
    if (
      activeCommentId.value &&
      !nextComments.some(
        (comment) => comment.$jazz.id === activeCommentId.value,
      )
    ) {
      activeCommentId.value = null;
    }
  },
  { deep: true },
);

onMounted(async () => {
  document.addEventListener("selectionchange", handleDocumentSelectionChange);
  window.addEventListener("resize", refreshSelectionBubblePosition);
  window.addEventListener("scroll", refreshSelectionBubblePosition, true);
  await loadCollaborationState();
});

onBeforeUnmount(() => {
  detachNativeSelectionListeners?.();
  document.removeEventListener(
    "selectionchange",
    handleDocumentSelectionChange,
  );
  window.removeEventListener("resize", refreshSelectionBubblePosition);
  window.removeEventListener("scroll", refreshSelectionBubblePosition, true);
  revokeJazzImageObjectUrls();
});
</script>

<template>
  <div>
    <div
      :class="
        hasUnresolvedComments
          ? 'space-y-8 px-4 py-8 sm:px-6 lg:px-8'
          : 'mx-auto flex max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-16 lg:px-8'
      "
    >
      <div class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center gap-2">
          <UBadge color="primary" variant="subtle"> Live collaboration </UBadge>

          <UBadge color="neutral" variant="outline"> Nuxt UI Editor </UBadge>

          <UBadge color="neutral" variant="outline">
            Jazz `co.richText()`
          </UBadge>

          <UBadge v-if="usesFallbackKey" color="warning" variant="soft">
            Shared demo key
          </UBadge>
        </div>

        <div class="space-y-3">
          <h1
            class="text-4xl font-semibold tracking-tight text-highlighted sm:text-5xl"
          >
            Collaborative editing with Nuxt UI and Jazz
          </h1>

          <p class="max-w-full text-lg text-muted">
            This demo keeps the editor experience in Nuxt UI while Jazz owns the
            shared rich text document. Open a second browser window, join with a
            writer link, and both editors will stay in sync.
          </p>
        </div>
      </div>

      <UAlert
        v-if="usesFallbackKey"
        color="warning"
        variant="soft"
        icon="i-lucide-key-round"
        title="Using a fallback Jazz Cloud key"
        description="Set `NUXT_PUBLIC_JAZZ_API_KEY` for your own isolated workspace. Until then, the demo uses a shared key so you can test the flow immediately."
      />

      <UAlert
        v-if="errorMessage"
        color="error"
        variant="soft"
        icon="i-lucide-circle-alert"
        title="Demo initialization failed"
        :description="errorMessage"
      />

      <UCard v-if="isLoading">
        <template #header>
          <div class="space-y-2">
            <USkeleton class="h-8 w-72" />
            <USkeleton class="h-5 w-full max-w-2xl" />
          </div>
        </template>

        <div class="space-y-3">
          <USkeleton class="h-10 w-full" />
          <USkeleton class="h-96 w-full" />
        </div>
      </UCard>

      <div
        v-else-if="sharedDoc"
        :class="
          hasUnresolvedComments
            ? 'grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_24rem]'
            : 'space-y-4'
        "
      >
        <UCard
          :ui="{
            body: 'p-0 sm:p-0',
          }"
        >
          <template #header>
            <div
              class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div class="space-y-1">
                <p class="text-sm font-medium text-muted">
                  {{
                    isInviteDocument
                      ? "Invited shared document"
                      : "Shared document"
                  }}
                </p>

                <input
                  :value="titleValue"
                  type="text"
                  placeholder="Untitled document"
                  aria-label="Document title"
                  class="w-full border-none bg-transparent p-0 text-2xl font-semibold text-highlighted outline-none placeholder:text-dimmed focus:ring-0"
                  @input="handleTitleInput"
                />
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <template v-if="!hasUnresolvedComments">
                  <UBadge
                    v-if="unresolvedCommentsCount || resolvedCommentsCount"
                    color="neutral"
                    variant="outline"
                  >
                    {{ unresolvedCommentsCount }}
                    <template v-if="resolvedCommentsCount">
                      / {{ resolvedCommentsCount }}
                    </template>
                  </UBadge>
                </template>

                <UButton
                  icon="i-lucide-file-plus-2"
                  color="neutral"
                  variant="soft"
                  :loading="isCreatingDocument"
                  @click="handleCreateDocument"
                >
                  New document
                </UButton>

                <UButton
                  icon="i-lucide-link"
                  :loading="isCopyingInvite"
                  @click="handleCopyInviteLink"
                >
                  Copy writer invite
                </UButton>
              </div>
            </div>
          </template>

          <div class="relative border-y border-default/60">
            <UEditor
              :key="sharedDoc.$jazz.id"
              content-type="html"
              placeholder="Start writing..."
              class="min-h-112"
              :handlers="customHandlers"
              :extensions="editorExtensions"
              :image="false"
              :on-create="handleEditorCreate"
              :on-selection-update="handleSelectionUpdate"
              :on-transaction="handleEditorTransaction"
            >
              <template #default="{ editor }">
                <div
                  class="sticky top-0 z-10 border-b border-default bg-default/90 p-3 backdrop-blur"
                >
                  <div class="flex flex-wrap items-center gap-2">
                    <UEditorToolbar :editor="editor" :items="toolbar" />

                    <UButton
                      color="neutral"
                      variant="ghost"
                      icon="i-lucide-image-up"
                      :loading="isUploadingImage"
                      @click="openImagePicker"
                    >
                      Upload image
                    </UButton>
                  </div>

                  <input
                    ref="imageUploadInput"
                    type="file"
                    accept="image/*"
                    class="hidden"
                    @change="handleImageUpload(editor, $event)"
                  />
                </div>

                <UEditorToolbar
                  :editor="editor"
                  :items="bubbleToolbarItems"
                  layout="bubble"
                  :should-show="shouldShowCommentBubble"
                />

                <UEditorToolbar
                  :editor="editor"
                  :items="imageBubbleToolbarItems"
                  plugin-key="imageBubbleMenu"
                  layout="bubble"
                  :should-show="shouldShowImageBubble"
                />

                <UEditorSuggestionMenu
                  :editor="editor"
                  :items="suggestionItems"
                />
              </template>
            </UEditor>
          </div>

          <template #footer>
            <div
              class="flex flex-col gap-3 text-sm text-muted sm:flex-row sm:items-center sm:justify-between"
            >
              <p>
                Tip: use the copied writer link in another browser profile or
                incognito window for the clearest collaboration test.
              </p>

              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-cloud" class="size-4" />
                <span>Jazz Cloud sync enabled</span>
              </div>
            </div>
          </template>
        </UCard>

        <aside
          v-if="hasUnresolvedComments"
          class="space-y-3 xl:sticky xl:top-6"
        >
          <div v-if="isDevelopment" class="flex justify-end">
            <UButton
              color="error"
              variant="soft"
              icon="i-lucide-trash-2"
              :disabled="comments.length === 0"
              @click="handleClearAllComments"
            >
              Clear all comments
            </UButton>
          </div>

          <FloatingCommentsRail
            :open-comments="floatingOpenComments"
            :resolved-comments="floatingResolvedComments"
            :disconnected-comments="floatingDisconnectedComments"
            :active-comment-id="activeCommentId"
            @focus-comment="handleFocusComment"
            @add-reply="handleAddReply"
            @resolve-comment="handleResolveComment"
            @reopen-comment="handleReopenComment"
          />
        </aside>
      </div>
    </div>

    <div
      v-if="
        selectionBubbleStyle && isSelectionComposerOpen && draftCommentSelection
      "
      class="fixed z-30"
      :style="selectionBubbleStyle"
    >
      <UCard class="w-96 max-w-[calc(100vw-2rem)] shadow-xl">
        <div class="space-y-3">
          <div class="flex items-start justify-between gap-3">
            <p class="text-xs font-medium text-highlighted">Comment</p>

            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              aria-label="Close comment composer"
              @click="closeSelectionComposer"
            />
          </div>

          <UTextarea
            :model-value="newComment"
            placeholder="Add a comment..."
            :rows="3"
            autofocus
            class="w-full"
            @update:model-value="newComment = $event"
            @keydown.enter.exact.prevent="handleAddComment"
          />

          <div class="flex justify-end gap-2">
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              @click="closeSelectionComposer"
            >
              Cancel
            </UButton>

            <UButton
              size="sm"
              icon="i-lucide-message-square-plus"
              :disabled="!newComment.trim()"
              @click="handleAddComment"
            >
              Comment
            </UButton>
          </div>
        </div>
      </UCard>
    </div>

    <USlideover
      v-if="!hasUnresolvedComments"
      v-model:open="commentsOpen"
      title="Comments"
      description="Resolved threads and open comments live here when the document is otherwise clear."
      side="right"
      class="w-full max-w-sm"
    >
      <template #body>
        <div class="space-y-3">
          <div v-if="isDevelopment" class="flex justify-end">
            <UButton
              color="error"
              variant="soft"
              icon="i-lucide-trash-2"
              :disabled="comments.length === 0"
              @click="handleClearAllComments"
            >
              Clear all comments
            </UButton>
          </div>

          <FloatingCommentsRail
            :open-comments="floatingOpenComments"
            :resolved-comments="floatingResolvedComments"
            :disconnected-comments="floatingDisconnectedComments"
            :active-comment-id="activeCommentId"
            @focus-comment="handleFocusComment"
            @add-reply="handleAddReply"
            @resolve-comment="handleResolveComment"
            @reopen-comment="handleReopenComment"
          />
        </div>
      </template>
    </USlideover>
  </div>
</template>

<style scoped>
:deep(.ProseMirror) {
  padding: 25px !important;
}

@media (max-width: 768px) {
  :deep(.ProseMirror) {
    padding: 15px !important;
  }
}
</style>
