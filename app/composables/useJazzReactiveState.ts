import { ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'

type JazzSubscribable = {
  $jazz: {
    subscribe: unknown
  }
}

type UseJazzReactiveStateOptions<TSource, TState> = {
  fallback: TState
  getValue: (source: TSource) => TState
  subscribeTo?: (source: TSource) => JazzSubscribable
  subscribeOptions?: unknown | ((source: TSource) => unknown)
}

export function useJazzReactiveState<
  TSource extends object,
  TState
>(
  source: MaybeRefOrGetter<TSource | null | undefined>,
  options: UseJazzReactiveStateOptions<TSource, TState>
): Ref<TState> {
  const state = ref(options.fallback) as Ref<TState>

  watch(() => toValue(source), (currentSource, _previousSource, onCleanup) => {
    if (!currentSource) {
      state.value = options.fallback
      return
    }

    state.value = options.getValue(currentSource)

    const subscribable = (options.subscribeTo?.(currentSource) ?? currentSource) as JazzSubscribable
    const jazzApi = subscribable.$jazz as {
      subscribe: (
        optionsOrListener: unknown,
        maybeListener?: (...args: unknown[]) => void
      ) => () => void
    }
    const refreshState = () => {
      const latestSource = toValue(source)
      state.value = latestSource
        ? options.getValue(latestSource)
        : options.fallback
    }
    const subscribeOptions = typeof options.subscribeOptions === 'function'
      ? options.subscribeOptions(currentSource)
      : options.subscribeOptions
    const unsubscribe = subscribeOptions === undefined
      ? jazzApi.subscribe(refreshState)
      : jazzApi.subscribe(subscribeOptions, refreshState)

    onCleanup(() => {
      unsubscribe()
    })
  }, {
    immediate: true
  })

  return state
}
