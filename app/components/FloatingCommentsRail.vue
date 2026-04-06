<script setup lang="ts">
type FloatingCommentLike = {
  $jazz: {
    id: string;
  };
  authorLabel: string;
  body: string;
  createdAt: number;
  replies: {
    length: number;
    [Symbol.iterator]: () => Iterator<{
      authorLabel: string;
      body: string;
      createdAt: number;
    }>;
  };
  quote?: string;
  resolvedAt?: number;
  resolvedBy?: string;
} & Record<string, any>;

const props = defineProps<{
  openComments: FloatingCommentLike[];
  resolvedComments: FloatingCommentLike[];
  disconnectedComments: FloatingCommentLike[];
  activeCommentId?: string | null;
}>();

const emit = defineEmits<{
  "focus-comment": [comment: FloatingCommentLike];
  "add-reply": [comment: FloatingCommentLike, body: string];
  "resolve-comment": [comment: FloatingCommentLike];
  "reopen-comment": [comment: FloatingCommentLike];
}>();

const showResolved = ref(false);
const showDisconnected = ref(true);
const expandedCommentId = ref<string | null>(null);
const replyDrafts = reactive<Record<string, string>>({});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function isExpanded(comment: FloatingCommentLike) {
  return expandedCommentId.value === comment.$jazz.id;
}

function toggleExpanded(comment: FloatingCommentLike) {
  expandedCommentId.value = isExpanded(comment) ? null : comment.$jazz.id;
}

function toggleExpandedFromCount(event: Event, comment: FloatingCommentLike) {
  event.stopPropagation();
  toggleExpanded(comment);
}

function formatTimestamp(timestamp: number) {
  return dateFormatter.format(timestamp);
}

function formatReplyCount(count: number) {
  return `${count} repl${count === 1 ? "y" : "ies"}`;
}

function getReplyDraft(comment: FloatingCommentLike) {
  return replyDrafts[comment.$jazz.id] ?? "";
}

function setReplyDraft(comment: FloatingCommentLike, value: string) {
  replyDrafts[comment.$jazz.id] = value;
}

function submitReply(comment: FloatingCommentLike) {
  const body = getReplyDraft(comment).trim();

  if (!body) {
    return;
  }

  emit("add-reply", comment, body);
  replyDrafts[comment.$jazz.id] = "";
  expandedCommentId.value = comment.$jazz.id;
}

watch(
  () => [
    ...props.openComments.map((comment) => comment.$jazz.id),
    ...props.resolvedComments.map((comment) => comment.$jazz.id),
    ...props.disconnectedComments.map((comment) => comment.$jazz.id),
  ],
  () => {
    if (
      expandedCommentId.value &&
      !props.openComments.some(
        (comment) => comment.$jazz.id === expandedCommentId.value,
      ) &&
      !props.resolvedComments.some(
        (comment) => comment.$jazz.id === expandedCommentId.value,
      ) &&
      !props.disconnectedComments.some(
        (comment) => comment.$jazz.id === expandedCommentId.value,
      )
    ) {
      expandedCommentId.value = null;
    }
  },
  { deep: true },
);

watch(
  () => props.activeCommentId,
  async (activeCommentId) => {
    if (!activeCommentId) {
      return;
    }

    const activeComment = [
      ...props.openComments,
      ...props.resolvedComments,
      ...props.disconnectedComments,
    ].find((comment) => comment.$jazz.id === activeCommentId);

    if (!activeComment) {
      return;
    }

    if (activeComment.resolvedAt) {
      showResolved.value = true;
    } else if (
      props.disconnectedComments.some(
        (comment) => comment.$jazz.id === activeCommentId,
      )
    ) {
      showDisconnected.value = true;
    }

    expandedCommentId.value = activeCommentId;

    await nextTick();
    document
      .getElementById(`comment-thread-${activeCommentId}`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  },
  { immediate: true },
);
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-3">
      <div class="space-y-1">
        <h3 class="text-sm font-semibold text-highlighted">Open comments</h3>
        <p class="text-xs text-muted">
          New comments start from a text selection in the editor.
        </p>
      </div>

      <UBadge color="primary" variant="subtle">
        {{ openComments.length }}
      </UBadge>
    </div>

    <div v-if="openComments.length" class="space-y-2">
      <UCard
        v-for="comment in openComments"
        :id="`comment-thread-${comment.$jazz.id}`"
        :key="comment.$jazz.id"
        variant="soft"
        :class="
          comment.$jazz.id === props.activeCommentId
            ? 'ring-2 ring-primary/40'
            : ''
        "
      >
        <div class="space-y-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 space-y-1">
              <div class="flex flex-wrap items-center gap-2">
                <p class="truncate text-sm font-semibold text-highlighted">
                  {{ comment.authorLabel }}
                </p>

                <UBadge color="primary" variant="subtle" size="sm">
                  Open
                </UBadge>
              </div>

              <p class="text-xs text-toned">
                {{ formatTimestamp(comment.createdAt) }}
              </p>
            </div>

            <div class="flex shrink-0 items-center gap-1">
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                :icon="
                  isExpanded(comment)
                    ? 'i-lucide-chevron-up'
                    : 'i-lucide-chevron-down'
                "
                :aria-label="
                  isExpanded(comment) ? 'Collapse thread' : 'Expand thread'
                "
                @click="toggleExpanded(comment)"
              />

              <UButton
                size="xs"
                color="neutral"
                variant="soft"
                icon="i-lucide-check"
                aria-label="Resolve thread"
                @click="emit('resolve-comment', comment)"
              >
                <span class="sr-only">Resolve</span>
              </UButton>
            </div>
          </div>

          <button
            type="button"
            class="block w-full space-y-3 rounded-xl border border-default/70 bg-default/60 p-3 text-left transition hover:border-primary/30 hover:bg-default"
            @click="emit('focus-comment', comment)"
          >
            <p
              v-if="comment.quote"
              class="truncate rounded-lg border border-default/80 bg-default px-3 py-2 text-xs text-toned"
            >
              “{{ comment.quote }}”
            </p>

            <p
              class="text-sm leading-6 text-default"
              :class="
                isExpanded(comment) ? 'whitespace-pre-wrap' : 'line-clamp-3'
              "
            >
              {{ comment.body }}
            </p>

            <div class="flex items-center justify-between gap-3 pt-1">
              <button
                v-if="comment.replies.length"
                type="button"
                class="inline-flex items-center gap-1 rounded-full border border-default/70 px-2.5 py-1 text-xs font-medium text-toned transition hover:border-primary/30 hover:text-highlighted"
                :aria-expanded="isExpanded(comment)"
                @click="toggleExpandedFromCount($event, comment)"
              >
                <UIcon name="i-lucide-messages-square" class="size-3.5" />
                {{ formatReplyCount(comment.replies.length) }}
              </button>

              <span v-else class="text-xs text-muted"> No replies yet </span>

              <span class="text-xs font-medium text-primary">
                Jump to source
              </span>
            </div>
          </button>

          <div
            v-if="isExpanded(comment)"
            class="space-y-3 border-t border-default/60 pt-4"
          >
            <div v-if="comment.replies.length" class="space-y-2">
              <div class="flex items-center justify-between gap-3">
                <span class="text-xs text-muted">
                  {{ formatReplyCount(comment.replies.length) }}
                </span>
              </div>

              <div
                v-for="(reply, index) in comment.replies"
                :key="`${comment.$jazz.id}-reply-${index}-${reply.createdAt}`"
                class="rounded-xl border border-default/70 bg-default/70 p-3 shadow-xs"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <p class="text-xs font-semibold text-highlighted">
                    {{ reply.authorLabel }}
                  </p>

                  <p class="text-[11px] text-toned">
                    {{ formatTimestamp(reply.createdAt) }}
                  </p>
                </div>

                <p
                  class="mt-2 whitespace-pre-wrap text-sm leading-6 text-default"
                >
                  {{ reply.body }}
                </p>
              </div>
            </div>

            <div class="rounded-xl border border-default/70 bg-default/60 p-3">
              <UTextarea
                :model-value="getReplyDraft(comment)"
                placeholder="Reply to thread..."
                :rows="2"
                autoresize
                class="w-full"
                @update:model-value="setReplyDraft(comment, $event)"
                @keydown.enter.exact.prevent="submitReply(comment)"
              />

              <div class="mt-3 flex justify-end">
                <UButton
                  size="sm"
                  icon="i-lucide-reply"
                  :disabled="!getReplyDraft(comment).trim()"
                  @click="submitReply(comment)"
                >
                  Reply
                </UButton>
              </div>
            </div>
          </div>
        </div>
      </UCard>
    </div>

    <UEmpty
      v-else-if="!resolvedComments.length && !disconnectedComments.length"
      icon="i-lucide-message-square"
      title="No open comments"
      description="Select text in the editor to start a new comment."
    />

    <UAlert
      v-else
      color="success"
      variant="soft"
      icon="i-lucide-check-check"
      title="All comments resolved"
      description="Resolved threads are tucked away below."
    />

    <UCard v-if="resolvedComments.length" variant="soft">
      <div class="space-y-3">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-3 text-left"
          @click="showResolved = !showResolved"
        >
          <div class="space-y-1">
            <h4 class="text-sm font-semibold text-highlighted">Resolved</h4>
            <p class="text-xs text-muted">
              Older threads stay hidden until you need them.
            </p>
          </div>

          <div class="flex items-center gap-2">
            <UBadge color="neutral" variant="outline">
              {{ resolvedComments.length }}
            </UBadge>

            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              :icon="
                showResolved ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'
              "
            />
          </div>
        </button>

        <div v-if="showResolved" class="space-y-2">
          <UCard
            v-for="comment in resolvedComments"
            :id="`comment-thread-${comment.$jazz.id}`"
            :key="comment.$jazz.id"
            variant="soft"
            :class="
              comment.$jazz.id === props.activeCommentId
                ? 'ring-2 ring-primary/40'
                : ''
            "
          >
            <div class="space-y-4">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 space-y-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="truncate text-sm font-semibold text-highlighted">
                      {{ comment.authorLabel }}
                    </p>

                    <UBadge color="success" variant="subtle" size="sm">
                      Resolved
                    </UBadge>
                  </div>

                  <p class="text-xs text-toned">
                    {{ formatTimestamp(comment.createdAt) }}
                  </p>
                </div>

                <div class="flex shrink-0 items-center gap-1">
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :icon="
                      isExpanded(comment)
                        ? 'i-lucide-chevron-up'
                        : 'i-lucide-chevron-down'
                    "
                    :aria-label="
                      isExpanded(comment) ? 'Collapse thread' : 'Expand thread'
                    "
                    @click="toggleExpanded(comment)"
                  />

                  <UButton
                    size="xs"
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-rotate-ccw"
                    @click="emit('reopen-comment', comment)"
                  >
                    Reopen
                  </UButton>
                </div>
              </div>

              <p
                v-if="comment.quote"
                class="truncate rounded-lg border border-default/80 bg-default/60 px-3 py-2 text-xs text-toned"
              >
                “{{ comment.quote }}”
              </p>

              <p
                class="text-sm leading-6 text-default"
                :class="
                  isExpanded(comment) ? 'whitespace-pre-wrap' : 'line-clamp-3'
                "
              >
                {{ comment.body }}
              </p>

              <button
                v-if="comment.replies.length"
                type="button"
                class="inline-flex items-center gap-1 rounded-full border border-default/70 px-2.5 py-1 text-xs font-medium text-toned transition hover:border-primary/30 hover:text-highlighted"
                :aria-expanded="isExpanded(comment)"
                @click="toggleExpandedFromCount($event, comment)"
              >
                <UIcon name="i-lucide-messages-square" class="size-3.5" />
                {{ formatReplyCount(comment.replies.length) }}
              </button>

              <div
                v-if="isExpanded(comment) && comment.replies.length"
                class="space-y-2 border-t border-default/60 pt-4"
              >
                <div
                  v-for="(reply, index) in comment.replies"
                  :key="`${comment.$jazz.id}-resolved-reply-${index}-${reply.createdAt}`"
                  class="rounded-xl border border-default/70 bg-default/70 p-3 shadow-xs"
                >
                  <div
                    class="flex flex-wrap items-center justify-between gap-2"
                  >
                    <p class="text-xs font-semibold text-highlighted">
                      {{ reply.authorLabel }}
                    </p>

                    <p class="text-[11px] text-toned">
                      {{ formatTimestamp(reply.createdAt) }}
                    </p>
                  </div>

                  <p
                    class="mt-2 whitespace-pre-wrap text-sm leading-6 text-default"
                  >
                    {{ reply.body }}
                  </p>
                </div>
              </div>

              <div class="flex items-center justify-between gap-2">
                <p v-if="comment.resolvedAt" class="text-xs text-muted">
                  Resolved
                  {{ formatTimestamp(comment.resolvedAt) }}
                  <span v-if="comment.resolvedBy"
                    >by {{ comment.resolvedBy }}</span
                  >
                </p>

                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-arrow-up-right"
                  @click="emit('focus-comment', comment)"
                >
                  Jump
                </UButton>
              </div>
            </div>
          </UCard>
        </div>
      </div>
    </UCard>

    <UCard v-if="disconnectedComments.length" variant="soft">
      <div class="space-y-3">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-3 text-left"
          @click="showDisconnected = !showDisconnected"
        >
          <div class="space-y-1">
            <h4 class="text-sm font-semibold text-highlighted">Disconnected</h4>
            <p class="text-xs text-muted">
              These comments no longer match the text they were originally
              attached to.
            </p>
          </div>

          <div class="flex items-center gap-2">
            <UBadge color="warning" variant="outline">
              {{ disconnectedComments.length }}
            </UBadge>

            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              :icon="
                showDisconnected
                  ? 'i-lucide-chevron-up'
                  : 'i-lucide-chevron-down'
              "
            />
          </div>
        </button>

        <div v-if="showDisconnected" class="space-y-2">
          <UCard
            v-for="comment in disconnectedComments"
            :id="`comment-thread-${comment.$jazz.id}`"
            :key="comment.$jazz.id"
            variant="soft"
            :class="
              comment.$jazz.id === props.activeCommentId
                ? 'ring-2 ring-warning/40'
                : ''
            "
          >
            <div class="space-y-4">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 space-y-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="truncate text-sm font-semibold text-highlighted">
                      {{ comment.authorLabel }}
                    </p>

                    <UBadge color="warning" variant="subtle" size="sm">
                      Disconnected
                    </UBadge>
                  </div>

                  <p class="text-xs text-toned">
                    {{ formatTimestamp(comment.createdAt) }}
                  </p>
                </div>

                <div class="flex shrink-0 items-center gap-1">
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :icon="
                      isExpanded(comment)
                        ? 'i-lucide-chevron-up'
                        : 'i-lucide-chevron-down'
                    "
                    :aria-label="
                      isExpanded(comment) ? 'Collapse thread' : 'Expand thread'
                    "
                    @click="toggleExpanded(comment)"
                  />

                  <UButton
                    v-if="!comment.resolvedAt"
                    size="xs"
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-check"
                    @click="emit('resolve-comment', comment)"
                  >
                    <span class="sr-only">Resolve</span>
                  </UButton>

                  <UButton
                    v-else
                    size="xs"
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-rotate-ccw"
                    @click="emit('reopen-comment', comment)"
                  >
                    Reopen
                  </UButton>
                </div>
              </div>

              <p
                v-if="comment.quote"
                class="truncate rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-toned"
              >
                Original quote: “{{ comment.quote }}”
              </p>

              <p
                class="text-sm leading-6 text-default"
                :class="
                  isExpanded(comment) ? 'whitespace-pre-wrap' : 'line-clamp-3'
                "
              >
                {{ comment.body }}
              </p>

              <button
                v-if="comment.replies.length"
                type="button"
                class="inline-flex items-center gap-1 rounded-full border border-default/70 px-2.5 py-1 text-xs font-medium text-toned transition hover:border-primary/30 hover:text-highlighted"
                :aria-expanded="isExpanded(comment)"
                @click="toggleExpandedFromCount($event, comment)"
              >
                <UIcon name="i-lucide-messages-square" class="size-3.5" />
                {{ formatReplyCount(comment.replies.length) }}
              </button>

              <div
                v-if="isExpanded(comment) && comment.replies.length"
                class="space-y-2 border-t border-default/60 pt-4"
              >
                <div class="flex items-center justify-between gap-3">
                  <p
                    class="text-xs font-semibold uppercase tracking-[0.18em] text-muted"
                  >
                    Conversation
                  </p>

                  <span class="text-xs text-muted">
                    {{ formatReplyCount(comment.replies.length) }}
                  </span>
                </div>

                <div
                  v-for="(reply, index) in comment.replies"
                  :key="`${comment.$jazz.id}-disconnected-reply-${index}-${reply.createdAt}`"
                  class="rounded-xl border border-default/70 bg-default/70 p-3 shadow-xs"
                >
                  <div
                    class="flex flex-wrap items-center justify-between gap-2"
                  >
                    <p class="text-xs font-semibold text-highlighted">
                      {{ reply.authorLabel }}
                    </p>

                    <p class="text-[11px] text-toned">
                      {{ formatTimestamp(reply.createdAt) }}
                    </p>
                  </div>

                  <p
                    class="mt-2 whitespace-pre-wrap text-sm leading-6 text-default"
                  >
                    {{ reply.body }}
                  </p>
                </div>
              </div>

              <div
                v-if="isExpanded(comment) && !comment.resolvedAt"
                class="rounded-xl border border-default/70 bg-default/60 p-3"
              >
                <UTextarea
                  :model-value="getReplyDraft(comment)"
                  placeholder="Reply to thread..."
                  :rows="2"
                  autoresize
                  class="w-full"
                  @update:model-value="setReplyDraft(comment, $event)"
                  @keydown.enter.exact.prevent="submitReply(comment)"
                />

                <div class="mt-3 flex justify-end">
                  <UButton
                    size="sm"
                    icon="i-lucide-reply"
                    :disabled="!getReplyDraft(comment).trim()"
                    @click="submitReply(comment)"
                  >
                    Reply
                  </UButton>
                </div>
              </div>
            </div>
          </UCard>
        </div>
      </div>
    </UCard>
  </div>
</template>
