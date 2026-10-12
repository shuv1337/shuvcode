import "./index.css"
import { Title, Meta } from "@solidjs/meta"
import { createAsync } from "@solidjs/router"
import { HttpStatusCode } from "@solidjs/start"
import { Header } from "~/component/header"
import { Footer } from "~/component/footer"
import { Legal } from "~/component/legal"
import { CHANGELOG_FILE_URL, changelogPage } from "~/lib/changelog-source"
import type { ChangelogEntry } from "~/lib/changelog-markdown"
import { For, Index, Show } from "solid-js"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { LocaleLinks } from "~/component/locale-links"

function formatDate(date: string, locale: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  })
}

function Release(props: { entry: ChangelogEntry; open: boolean }) {
  const i18n = useI18n()
  const language = useLanguage()

  return (
    <article data-component="release" id={props.entry.anchor}>
      <header>
        <h2>
          <a href={`#${props.entry.anchor}`}>{props.entry.tag}</a>
        </h2>
        <Show when={props.entry.date}>
          {(date) => <time dateTime={date()}>{formatDate(date(), language.tag(language.locale()))}</time>}
        </Show>
      </header>
      <div data-slot="content">
        <Show when={props.entry.intro}>
          <div data-slot="markdown" innerHTML={props.entry.intro} />
        </Show>
        <Show when={props.entry.highlights.length > 0}>
          <section data-component="highlights">
            <h3 data-slot="label">{i18n.t("changelog.highlights")}</h3>
            <ul>
              <For each={props.entry.highlights}>
                {(item) => (
                  <li>
                    <Show when={item.title}>
                      <p data-slot="title" innerHTML={item.title} />
                    </Show>
                    <p innerHTML={item.body} />
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>
        <Show when={props.entry.sections.length > 0}>
          <div data-component="sections">
            <For each={props.entry.sections}>
              {(section) => (
                <details data-component="section" open={props.open}>
                  <summary>
                    <span data-slot="label">{section.title}</span>
                  </summary>
                  <div data-slot="markdown" innerHTML={section.body} />
                </details>
              )}
            </For>
          </div>
        </Show>
      </div>
    </article>
  )
}

export default function Changelog() {
  const i18n = useI18n()
  const language = useLanguage()
  const data = createAsync(() => changelogPage())

  return (
    <main data-page="changelog">
      <Title>{i18n.t("changelog.title")}</Title>
      <LocaleLinks path="/changelog" />
      <Meta name="description" content={i18n.t("changelog.meta.description")} />

      <div data-component="container">
        <Header />

        <div data-component="content">
          <section data-component="changelog-hero">
            <h1>{i18n.t("changelog.hero.title")}</h1>
            <p>{i18n.t("changelog.hero.subtitle")}</p>
          </section>

          <section data-component="releases">
            <Show when={data()}>
              {(page) => (
                <>
                  <Show when={!page().ok}>
                    <HttpStatusCode code={503} />
                    <p data-slot="notice">
                      {i18n.t("changelog.error")}{" "}
                      <a href={CHANGELOG_FILE_URL} target="_blank" rel="noopener noreferrer">
                        {i18n.t("changelog.viewOnGithub")}
                      </a>
                    </p>
                  </Show>
                  <Show when={page().ok && page().entries.length === 0}>
                    <p data-slot="notice">{i18n.t("changelog.empty")}</p>
                  </Show>
                  <Index each={page().entries}>
                    {(entry, index) => <Release entry={entry()} open={index === 0} />}
                  </Index>
                </>
              )}
            </Show>
          </section>

          <p data-slot="v1">
            <a href="https://github.com/anomalyco/opencode/releases" target="_blank" rel="noopener noreferrer">
              {i18n.t("changelog.v1")}
            </a>
          </p>
        </div>

        <Footer />
      </div>

      <Legal />
    </main>
  )
}
