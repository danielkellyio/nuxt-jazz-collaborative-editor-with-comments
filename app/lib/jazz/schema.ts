import { co, ImageDefinition, z } from 'jazz-tools'

export const CommentReplyItem = co.map({
  authorLabel: z.string(),
  body: z.string(),
  createdAt: z.number()
})

export const CommentItem = co.map({
  authorLabel: z.string(),
  body: z.string(),
  createdAt: z.number(),
  blockIndex: z.number().optional(),
  blockText: z.string().optional(),
  blockAnchor: z.number().optional(),
  blockHead: z.number().optional(),
  anchor: z.number().optional(),
  head: z.number().optional(),
  quote: z.string().optional(),
  replies: co.list(CommentReplyItem),
  resolvedAt: z.number().optional(),
  resolvedBy: z.string().optional()
}).withMigration((comment) => {
  if (comment.replies === undefined) {
    comment.$jazz.set('replies', [])
  }
})

export const CursorPresence = z.object({
  accountId: z.string(),
  sessionId: z.string(),
  label: z.string(),
  color: z.string(),
  anchor: z.number(),
  head: z.number(),
  focused: z.boolean(),
  updatedAt: z.number()
})

export const CollaborativeDocument = co.map({
  title: z.string(),
  content: co.richText(),
  images: co.list(ImageDefinition),
  presence: co.feed(CursorPresence),
  comments: co.list(CommentItem)
}).withMigration((document) => {
  if (document.images === undefined) {
    document.$jazz.set('images', [])
  }

  if (document.presence === undefined) {
    document.$jazz.set('presence', [])
  }

  if (document.comments === undefined) {
    document.$jazz.set('comments', [])
  }
})

export const AppAccountRoot = co.map({
  currentDocument: CollaborativeDocument
})

export const AppAccount = co
  .account({
    root: AppAccountRoot,
    profile: co.profile()
  })
  .withMigration((account) => {
    if (!account.$jazz.has('root')) {
      account.$jazz.set('root', {
        currentDocument: {
          title: 'Nuxt UI + Jazz demo',
          content: `
<h2>Start collaborating</h2>
<p>This editor uses <strong>Nuxt UI</strong> for the authoring experience and <strong>Jazz</strong> for the shared rich text document.</p>
<p>Open the app in another browser window, paste a writer invite link, and both sessions will stay in sync.</p>
          `.trim(),
          images: [],
          presence: [],
          comments: []
        }
      })
    }
  })
