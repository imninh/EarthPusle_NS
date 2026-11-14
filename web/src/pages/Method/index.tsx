import { useMemo, useState } from 'react'
import { Chip } from '../../components/ui'
import { useApp } from '../../data/AppState'
import type { VariableMeta } from '../../data/types'
import { GLOSSARY, GLOSSARY_ORDER, formatUnit } from '../../lib/format'
import {
  CHALLENGE_ROWS,
  CHECK_TOOLS,
  CHECK_TOOLS_SENTENCE,
  METHOD_DOC_LINKS,
  METHOD_LIMITATIONS,
  METHOD_STEPS,
  SHEET_TEXT,
  challengeHref,
  sheetSourceLine,
  type SheetLang,
} from './content'
import './method.css'

interface ProductCard {
  key: string
  product: string
  version: string
  doi: string | null
  variables: string[]
  units: string[]
}

function collectProducts(variables: readonly VariableMeta[]): ProductCard[] {
  const byKey = new Map<string, ProductCard>()
  for (const variable of variables) {
    const key = `${variable.product}::${variable.product_version}::${variable.doi ?? ''}`
    const current = byKey.get(key)
    if (current) {
      current.variables.push(variable.label)
      if (!current.units.includes(variable.display_unit)) current.units.push(variable.display_unit)
    } else {
      byKey.set(key, {
        key,
        product: variable.product,
        version: variable.product_version,
        doi: variable.doi ?? null,
        variables: [variable.label],
        units: [variable.display_unit],
      })
    }
  }
  return [...byKey.values()]
}

function doiHref(doi: string | null): string | null {
  return doi ? `https://doi.org/${doi}` : null
}

export default function MethodPage() {
  const { index, navigate } = useApp()
  const products = useMemo(() => collectProducts(index.variables), [index.variables])
  const witnessProducts = Object.entries(index.witness?.products ?? {})
  const [sheetLang, setSheetLang] = useState<SheetLang>('en')
  const sheet = SHEET_TEXT[sheetLang]
  const sourceLine = sheetSourceLine(sheet.sourcePrefix, [
    ...products.map((p) => ({ product: p.product, version: p.version, doi: p.doi })),
    ...witnessProducts.map(([, w]) => ({ product: w.product, version: w.version, doi: w.doi })),
  ])

  return (
    <section className="method">
      <header className="method-head">
        <p className="eyebrow">How it works</p>
        <h1>From a NASA file to a trend you can question</h1>
        <p className="method-lede">
          EarthPulse turns monthly satellite and model data into one comparable grid, tests every cell for a trend,
          checks whether a sudden shift could explain it, and asks a second NASA dataset whether it sees the same thing.
        </p>
        <div className="method-meta">
          <Chip tone="accent">{index.variables.length} published variables</Chip>
          <Chip tone="accent">FDR q &lt; {index.q_threshold}</Chip>
          <Chip>{index.witness ? 'Second witness available' : 'Second witness not in this export'}</Chip>
        </div>
      </header>

      <section className="method-section method-section--wide" aria-labelledby="method-challenge-title">
        <h2 id="method-challenge-title">How EarthPulse answers the challenge</h2>
        <p className="method-section-note">
          The challenge asks for four things and names a few ideas worth adding. Here is where each one lives in the app.
        </p>
        <div className="method-table-wrap">
          <table className="method-table">
            <thead>
              <tr>
                <th scope="col">The challenge says</th>
                <th scope="col">Where in EarthPulse</th>
                <th scope="col">Go there</th>
              </tr>
            </thead>
            <tbody>
              {CHALLENGE_ROWS.map((row) => (
                <tr key={row.id}>
                  <td data-label="The challenge says">
                    <span className="label-caps method-table-kind">{row.kind}</span>
                    <q className="method-table-phrase">{row.phrase}</q>
                  </td>
                  <td data-label="Where in EarthPulse">{row.where}</td>
                  <td data-label="Go there">
                    <a
                      className="method-table-link"
                      href={challengeHref(row.page)}
                      onClick={(event) => {
                        event.preventDefault()
                        navigate(row.page)
                      }}
                    >
                      {row.linkLabel}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="method-section method-section--wide" aria-labelledby="method-flow-title">
        <h2 id="method-flow-title">The pipeline at a glance</h2>
        <ol className="method-flow" aria-label="Analysis steps">
          {METHOD_STEPS.map((step, position) => (
            <li key={step.id} className="method-flow-item">
              <span className="method-flow-number" aria-hidden="true">
                {position + 1}
              </span>
              <span className="method-flow-title">{step.title}</span>
              <span className="method-flow-technical">{step.technical}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="method-section" aria-labelledby="method-steps-title">
        <h2 id="method-steps-title">Each step, in plain language</h2>
        <div className="method-steps">
          {METHOD_STEPS.map((step, position) => (
            <article key={step.id} className="method-step ui-card">
              <div className="method-step-head">
                <span className="method-step-number">{position + 1}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p className="method-technical">({step.technical})</p>
                </div>
              </div>
              <p>{step.body}</p>
              <p className="method-why">
                <strong>Why it matters:</strong> {step.why}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="method-section" aria-labelledby="method-words-title">
        <h2 id="method-words-title">Words we use</h2>
        <p className="method-section-note">
          Plain words first, with the exact method name in brackets for anyone who wants it. The same explanations
          appear behind the &ldquo;?&rdquo; buttons across the app.
        </p>
        <dl className="method-glossary">
          {GLOSSARY_ORDER.map((id) => {
            const entry = GLOSSARY[id]
            return (
              <div key={id} className="method-glossary-item ui-card">
                <dt>{entry.term}</dt>
                <dd>
                  <span>{entry.plain}</span>
                  <span className="method-technical">({entry.technical})</span>
                </dd>
              </div>
            )
          })}
        </dl>
      </section>

      <section className="method-section" aria-labelledby="method-products-title">
        <h2 id="method-products-title">Products and DOIs</h2>
        <p className="method-section-note">
          Every card is read from the published index. A DOI link opens the product landing page; the product version is
          part of the card.
        </p>
        <div className="method-products">
          {products.map((product) => (
            <article key={product.key} className="method-product ui-card">
              <div className="method-product-head">
                <h3>{product.product}</h3>
                <Chip>{product.version}</Chip>
              </div>
              <p className="method-product-vars">{product.variables.join(' · ')}</p>
              <p className="method-product-units">
                Reported in {product.units.map(formatUnit).join(' · ')}
              </p>
              {doiHref(product.doi) ? (
                <a href={doiHref(product.doi) ?? '#'} target="_blank" rel="noreferrer">
                  DOI {product.doi}
                </a>
              ) : (
                <span className="method-muted">DOI not available in the index</span>
              )}
            </article>
          ))}
        </div>

        <h3 className="method-subhead">Second-witness products</h3>
        {witnessProducts.length > 0 ? (
          <div className="method-products">
            {witnessProducts.map(([variableId, witness]) => (
              <article key={variableId} className="method-product ui-card method-witness">
                <div className="method-product-head">
                  <h3>{witness.label}</h3>
                  <Chip tone="good">{witness.product}</Chip>
                </div>
                <p className="method-product-vars">
                  Checks {variableId.replaceAll('_', ' ')} via {witness.source_variable} · version {witness.version}
                </p>
                <a href={doiHref(witness.doi) ?? '#'} target="_blank" rel="noreferrer">
                  DOI {witness.doi}
                </a>
              </article>
            ))}
          </div>
        ) : (
          <p className="method-muted">
            Second-witness products appear automatically when a schema 1.3 export is published. The current export is
            schema {index.schema_version}; all witness fields are optional and hidden in this build.
          </p>
        )}
      </section>

      <section className="method-section" aria-labelledby="method-limits-title">
        <h2 id="method-limits-title">Limitations to keep in view</h2>
        <ul className="method-limits">
          {METHOD_LIMITATIONS.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </section>

      <section className="method-section" aria-labelledby="method-docs-title">
        <h2 id="method-docs-title">Repository documentation</h2>
        <p className="method-section-note">
          The app is the short version; the repository holds the full method, limits and file contract.
        </p>
        <ul className="method-docs">
          {METHOD_DOC_LINKS.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
              <span>{link.description}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="method-section" aria-labelledby="method-tools-title">
        <h2 id="method-tools-title">Tools to check our numbers</h2>
        <p className="method-section-note">{CHECK_TOOLS_SENTENCE}</p>
        <ul className="method-docs">
          {CHECK_TOOLS.map((tool) => (
            <li key={tool.href}>
              <a href={tool.href} target="_blank" rel="noopener">
                {tool.label}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="method-section method-class" aria-labelledby="method-class-title">
        <h2 id="method-class-title">Use it in class (15 minutes)</h2>
        <p className="method-section-note">
          A one-page activity for a teacher or a student. Choose a language, print it, and work through the tasks in the
          app.
        </p>
        <div className="method-class-tools">
          <div className="method-lang" role="group" aria-label="Sheet language">
            <button
              type="button"
              className="method-lang-button"
              aria-pressed={sheetLang === 'en'}
              onClick={() => setSheetLang('en')}
            >
              English
            </button>
            <button
              type="button"
              className="method-lang-button"
              aria-pressed={sheetLang === 'vi'}
              onClick={() => setSheetLang('vi')}
            >
              Tiếng Việt
            </button>
          </div>
          <button type="button" className="button primary" onClick={() => window.print()}>
            {sheet.printLabel}
          </button>
        </div>

        <article className="method-sheet" lang={sheetLang} aria-labelledby="method-sheet-title">
          <header className="method-sheet-head">
            <p className="label-caps method-sheet-kicker">{sheet.subtitle}</p>
            <h3 id="method-sheet-title">{sheet.title}</h3>
            <p className="method-sheet-name">
              <span>{sheet.nameLine}</span>
              <span className="method-sheet-rule" aria-hidden="true" />
            </p>
          </header>
          <ol className="method-sheet-tasks" aria-label={sheet.tasksLabel}>
            {sheet.tasks.map((task) => (
              <li key={task}>
                <p>{task}</p>
                <span className="method-sheet-rule" aria-hidden="true" />
                <span className="method-sheet-rule" aria-hidden="true" />
              </li>
            ))}
          </ol>
          <p className="method-sheet-source">{sourceLine}</p>
        </article>
      </section>
    </section>
  )
}
