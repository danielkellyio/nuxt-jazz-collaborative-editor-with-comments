import type { NuxtApp } from '#app'
import { consumeInviteLinkFromWindowLocation, type JazzBrowserContextManager } from 'jazz-tools/browser'
import { AppAccount, CollaborativeDocument } from '~/lib/jazz/schema'

type AppAccountSchema = typeof AppAccount
type DocumentLoadAs = NonNullable<Parameters<typeof CollaborativeDocument.load>[1]>['loadAs']

type JazzNuxtApp = NuxtApp & {
  $jazz: JazzBrowserContextManager<AppAccountSchema>
}

const documentResolve = {
  content: true,
  images: {
    $each: true
  },
  comments: {
    $each: true
  },
  presence: {
    $each: true
  }
} as const

async function loadCollaborativeDocument(documentId: string, loadAs?: DocumentLoadAs) {
  const document = await CollaborativeDocument.load(documentId, loadAs ? { loadAs } : undefined)

  if (!document.$isLoaded) {
    throw new Error('Shared document failed to load.')
  }

  return await document.$jazz.ensureLoaded({
    resolve: documentResolve
  })
}

export async function useJazzDocument(documentId?: string) {
  const jazz = (useNuxtApp() as JazzNuxtApp).$jazz
  const context = jazz.getCurrentValue()

  if (!context || !('me' in context)) {
    throw new Error('Jazz context is not available yet.')
  }

  const account = await AppAccount.load(context.me.$jazz.id)

  if (!account.$isLoaded) {
    throw new Error('Jazz account failed to load.')
  }

  account.migrate()

  const loadedAccount = await account.$jazz.ensureLoaded({
    resolve: {
      root: {
        currentDocument: documentResolve
      }
    }
  })

  const acceptedInvite = await consumeInviteLinkFromWindowLocation({
    as: context.me,
    forValueHint: 'nuxt-ui-jazz-demo',
    invitedObjectSchema: CollaborativeDocument
  })

  if (acceptedInvite) {
    return {
      account: loadedAccount,
      document: await loadCollaborativeDocument(acceptedInvite.valueID, context.me),
      isInviteDocument: true
    }
  }

  if (documentId) {
    return {
      account: loadedAccount,
      document: await loadCollaborativeDocument(documentId, context.me),
      isInviteDocument: false
    }
  }

  return {
    account: loadedAccount,
    document: loadedAccount.root.currentDocument,
    isInviteDocument: false
  }
}
