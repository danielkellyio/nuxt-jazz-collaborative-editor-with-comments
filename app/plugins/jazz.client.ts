import { JazzBrowserContextManager } from 'jazz-tools/browser'

type AppAccountSchema = typeof import('~/lib/jazz/schema').AppAccount

let contextManagerPromise: Promise<JazzBrowserContextManager<AppAccountSchema>> | null = null

async function getContextManager() {
  if (!contextManagerPromise) {
    contextManagerPromise = (async () => {
      const config = useRuntimeConfig()
      const contextManager = new JazzBrowserContextManager<AppAccountSchema>()
      const apiKey = config.public.jazzApiKey || 'nuxt-ui-jazz-demo'

      await contextManager.createContext({
        sync: {
          peer: `wss://cloud.jazz.tools?key=${apiKey}`,
          when: 'always'
        }
      })

      return contextManager
    })()
  }

  return contextManagerPromise
}

export default defineNuxtPlugin(async () => {
  const jazz = await getContextManager()

  return {
    provide: {
      jazz
    }
  }
})
