import { useEffect, useMemo, useState } from 'react'
import { Chip } from '../../components/ui'
import { useApp } from '../../data/AppState'
import type { VariableMeta } from '../../data/types'
import { useLang, useStrings, variableLabel, type Lang } from '../../i18n'
import { GLOSSARY_ORDER, formatUnitIn, glossaryEntry } from '../../lib/format'
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
import * as VI from './content.vi'
import { METHOD_STRINGS } from './strings'
import './method.css'

interface ProductCard {
  key: string
  product: string
  version: string
  doi: string | null
  variables: string[]
  units: string[]
}

function collectProducts(variables: readonly VariableMeta[], lang: Lang): ProductCard[] {
  const byKey = new Map<string, ProductCard>()
  for (const variable of variables) {
    const key = `${variable.product}::${variable.product_version}::${variable.doi ?? ''}`
    const current = byKey.get(key)
    if (current) {
      current.variables.push(variableLabel(variable, lang))
      if (!current.units.includes(variable.display_unit)) current.units.push(variable.display_unit)
    } else {
      byKey.set(key, {
        key,
        product: variable.product,
        version: variable.product_version,
        doi: variable.doi ?? null,
        variables: [variableLabel(variable, lang)],
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
  const { lang } = useLang()
  const s = useStrings(METHOD_STRINGS)
  const isVi = lang === 'vi'
  const steps = isVi ? VI.METHOD_STEPS : METHOD_STEPS
  const limitations = isVi ? VI.METHOD_LIMITATIONS : METHOD_LIMITATIONS
  const docLinks = isVi ? VI.METHOD_DOC_LINKS : METHOD_DOC_LINKS
  const challengeRows = isVi ? VI.CHALLENGE_ROWS : CHALLENGE_ROWS
  const checkTools = isVi ? VI.CHECK_TOOLS : CHECK_TOOLS
  const checkToolsSentence = isVi ? VI.CHECK_TOOLS_SENTENCE : CHECK_TOOLS_SENTENCE
  const products = useMemo(() => collectProducts(index.variables, lang), [index.variables, lang])
  const witnessProducts = Object.entries(index.witness?.products ?? {})
  const [sheetLang, setSheetLang] = useState<SheetLang>(lang)
  useEffect(() => {
    setSheetLang(lang)
  }, [lang])
  const witnessVariableName = (variableId: string): string => {
    const known = index.variables.find((variable) => variable.id === variableId)
    return known && isVi ? variableLabel(known, lang) : variableId.replaceAll('_', ' ')
  }
  const sheet = SHEET_TEXT[sheetLang]
  const sourceLine = sheetSourceLine(sheet.sourcePrefix, [
    ...products.map((p) => ({ product: p.product, version: p.version, doi: p.doi })),
    ...witnessProducts.map(([, w]) => ({ product: w.product, version: w.version, doi: w.doi })),
  ])

  return (
    <section className="method">
      <header className="method-head">
        <p className="eyebrow">{s.eyebrow}</p>
        <h1>{s.title}</h1>
        <p className="method-lede">{s.lede}</p>
        <div className="method-meta">
          <Chip tone="accent">{s.publishedVariables(index.variables.length)}</Chip>
          <Chip tone="accent">{s.fdrChip(index.q_threshold)}</Chip>
          <Chip>{index.witness ? s.witnessAvailable : s.witnessMissing}</Chip>
        </div>
      </header>

      <section className="method-section method-section--wide" aria-labelledby="method-challenge-title">
        <h2 id="method-challenge-title">{s.challengeTitle}</h2>
        <p className="method-section-note">{s.challengeNote}</p>
        <div className="method-table-wrap">
          <table className="method-table">
            <thead>
              <tr>
                <th scope="col">{s.thChallenge}</th>
                <th scope="col">{s.thWhere}</th>
                <th scope="col">{s.thGo}</th>
              </tr>
            </thead>
            <tbody>
              {challengeRows.map((row) => (
                <tr key={row.id}>
                  <td data-label={s.thChallenge}>
                    <span className="label-caps method-table-kind">
                      {row.kind === 'Objective' ? s.kindObjective : s.kindConsideration}
                    </span>
                    <q className="method-table-phrase">{row.phrase}</q>
                  </td>
                  <td data-label={s.thWhere}>{row.where}</td>
                  <td data-label={s.thGo}>
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
        <h2 id="method-flow-title">{s.flowTitle}</h2>
        <ol className="method-flow" aria-label={s.flowAria}>
          {steps.map((step, position) => (
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
        <h2 id="method-steps-title">{s.stepsTitle}</h2>
        <div className="method-steps">
          {steps.map((step, position) => (
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
                <strong>{s.whyItMatters}</strong> {step.why}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="method-section" aria-labelledby="method-words-title">
        <h2 id="method-words-title">{s.wordsTitle}</h2>
        <p className="method-section-note">{s.wordsNote}</p>
        <dl className="method-glossary">
          {GLOSSARY_ORDER.map((id) => {
            const entry = glossaryEntry(id, lang)
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
        <h2 id="method-products-title">{s.productsTitle}</h2>
        <p className="method-section-note">{s.productsNote}</p>
        <div className="method-products">
          {products.map((product) => (
            <article key={product.key} className="method-product ui-card">
              <div className="method-product-head">
                <h3>{product.product}</h3>
                <Chip>{product.version}</Chip>
              </div>
              <p className="method-product-vars">{product.variables.join(' · ')}</p>
              <p className="method-product-units">{s.reportedIn(product.units.map((unit) => formatUnitIn(unit, lang)).join(' · '))}</p>
              {doiHref(product.doi) ? (
                <a href={doiHref(product.doi) ?? '#'} target="_blank" rel="noreferrer">
                  {s.doi(product.doi ?? '')}
                </a>
              ) : (
                <span className="method-muted">{s.doiMissing}</span>
              )}
            </article>
          ))}
        </div>

        <h3 className="method-subhead">{s.witnessProductsTitle}</h3>
        {witnessProducts.length > 0 ? (
          <div className="method-products">
            {witnessProducts.map(([variableId, witness]) => (
              <article key={variableId} className="method-product ui-card method-witness">
                <div className="method-product-head">
                  <h3>{witness.label}</h3>
                  <Chip tone="good">{witness.product}</Chip>
                </div>
                <p className="method-product-vars">
                  {s.witnessChecks(witnessVariableName(variableId), witness.source_variable, witness.version)}
                </p>
                <a href={doiHref(witness.doi) ?? '#'} target="_blank" rel="noreferrer">
                  {s.doi(witness.doi)}
                </a>
              </article>
            ))}
          </div>
        ) : (
          <p className="method-muted">{s.witnessProductsLater(String(index.schema_version))}</p>
        )}
      </section>

      <section className="method-section" aria-labelledby="method-limits-title">
        <h2 id="method-limits-title">{s.limitsTitle}</h2>
        <ul className="method-limits">
          {limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </section>

      <section className="method-section" aria-labelledby="method-docs-title">
        <h2 id="method-docs-title">{s.docsTitle}</h2>
        <p className="method-section-note">{s.docsNote}</p>
        <ul className="method-docs">
          {docLinks.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
              <span>{link.description}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="method-section" aria-labelledby="method-tools-title">
        <h2 id="method-tools-title">{s.toolsTitle}</h2>
        <p className="method-section-note">{checkToolsSentence}</p>
        <ul className="method-docs">
          {checkTools.map((tool) => (
            <li key={tool.href}>
              <a href={tool.href} target="_blank" rel="noopener">
                {tool.label}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="method-section method-class" aria-labelledby="method-class-title">
        <h2 id="method-class-title">{s.classTitle}</h2>
        <p className="method-section-note">{s.classNote}</p>
        <div className="method-class-tools">
          <div className="method-lang" role="group" aria-label={s.sheetLanguage}>
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
