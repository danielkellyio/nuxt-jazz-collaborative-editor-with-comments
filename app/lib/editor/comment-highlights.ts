import type { Editor } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

type CommentHighlight = {
  id?: string
  anchor?: number
  head?: number
  active?: boolean
  draft?: boolean
}

type CommentHighlightsState = {
  comments: CommentHighlight[]
}

const commentHighlightsPluginKey = new PluginKey<CommentHighlightsState>('comment-highlights')

function buildDecorations(doc: Parameters<typeof DecorationSet.create>[0], comments: CommentHighlight[]) {
  const decorations = comments.flatMap((comment) => {
    if (typeof comment.anchor !== 'number' || typeof comment.head !== 'number') {
      return []
    }

    const from = Math.min(comment.anchor, comment.head)
    const to = Math.max(comment.anchor, comment.head)

    if (from === to) {
      return []
    }

    const max = doc.content.size
    const safeFrom = Math.min(Math.max(1, from), max)
    const safeTo = Math.min(Math.max(safeFrom, to), max)

    if (safeFrom === safeTo) {
      return []
    }

    return [
      Decoration.inline(safeFrom, safeTo, {
        'class': comment.draft
          ? 'comment-highlight comment-highlight-draft'
          : comment.active
            ? 'comment-highlight comment-highlight-active'
            : 'comment-highlight',
        'data-comment-id': comment.id
      })
    ]
  })

  return DecorationSet.create(doc, decorations)
}

export const CommentHighlightsExtension = Extension.create({
  name: 'commentHighlights',

  addProseMirrorPlugins() {
    return [
      new Plugin<CommentHighlightsState>({
        key: commentHighlightsPluginKey,
        state: {
          init: () => ({
            comments: []
          }),
          apply(tr, value) {
            const nextComments = tr.getMeta(commentHighlightsPluginKey) as CommentHighlight[] | undefined

            if (nextComments) {
              return {
                comments: nextComments
              }
            }

            return value
          }
        },
        props: {
          decorations(state) {
            const pluginState = commentHighlightsPluginKey.getState(state)
            return buildDecorations(state.doc, pluginState?.comments ?? [])
          }
        }
      })
    ]
  }
})

export function updateCommentHighlights(editor: Editor, comments: CommentHighlight[]) {
  const transaction = editor.state.tr.setMeta(commentHighlightsPluginKey, comments)
  editor.view.dispatch(transaction)
}
