<script setup lang="ts">
useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' }
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' }
  ],
  htmlAttrs: {
    lang: 'en'
  }
})

const title = 'Nuxt UI + Jazz Collaboration Demo'
const description = 'A live rich text collaboration demo built with Nuxt UI and Jazz.'

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  twitterCard: 'summary_large_image'
})
</script>

<template>
  <UApp>
    <UHeader class="border-b border-default/60">
      <template #left>
        <NuxtLink
          to="/"
          class="flex items-center gap-3"
        >
          <UBadge
            color="primary"
            variant="subtle"
          >
            Demo
          </UBadge>

          <span class="font-semibold text-highlighted">
            Nuxt UI + Jazz
          </span>
        </NuxtLink>
      </template>

      <template #right>
        <UColorModeButton />
      </template>
    </UHeader>

    <UMain class="bg-default">
      <NuxtPage />
    </UMain>

    <UFooter>
      <template #left>
        <p class="text-sm text-muted">
          Built with Nuxt UI and Jazz • © {{ new Date().getFullYear() }}
        </p>
      </template>

      <template #right>
        <span class="text-sm text-muted">
          Open two windows to test live sync
        </span>
      </template>
    </UFooter>
  </UApp>
</template>
