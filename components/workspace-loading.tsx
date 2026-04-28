import type { ReactNode } from "react";

/**
 * Shared loading primitives for workspace pages so each route can stream its
 * real content behind a consistent, intentional shell.
 */

export function LoadingPanelFrame({
  title,
  headingAside,
  toolbar,
  children,
  className,
}: {
  title: string;
  headingAside?: ReactNode;
  toolbar?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel-frame${className ? ` ${className}` : ""}`}>
      <div className={`panel-heading ${headingAside ? "panel-heading--split" : "panel-heading--simple"}`}>
        <h1 className="panel-title">{title}</h1>
        {headingAside}
      </div>

      {toolbar}
      {children}
    </section>
  );
}

export function LoadingMonthNav({ monthLabel }: { monthLabel: string }) {
  return (
    <div className="metrics-month-nav" aria-hidden="true">
      <div className="metrics-month-nav__current">
        <strong>{monthLabel}</strong>
      </div>
      <div className="metrics-month-nav__actions">
        <span className="loading-block loading-block--button" />
        <span className="loading-block loading-block--button" />
      </div>
    </div>
  );
}

export function LoadingActions({ count = 3 }: { count?: number }) {
  return (
    <div className="planner-actions" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="loading-block loading-block--button" />
      ))}
    </div>
  );
}

export function LoadingToolbarFields({
  fields,
  className,
}: {
  fields: Array<{ label: string; value: string }>;
  className?: string;
}) {
  return (
    <div className={className} aria-hidden="true">
      {fields.map((field) => (
        <div key={field.label} className="field field--static">
          <span>{field.label}</span>
          <strong>{field.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function LoadingToolbarWithActions({
  fields,
  actions = 3,
  className = "workspace-toolbar workspace-toolbar--actions",
}: {
  fields?: Array<{ label: string; value: string }>;
  actions?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      <LoadingActions count={actions} />
      {fields?.length ? (
        <div className="toolbar-status-wrap" aria-hidden="true">
          <LoadingToolbarFields fields={fields} />
        </div>
      ) : (
        <div className="toolbar-status-wrap" aria-hidden="true">
          <span className="loading-block loading-block--md" />
        </div>
      )}
    </div>
  );
}

export function LoadingTable({
  columns,
  rows = 5,
}: {
  columns: string[];
  rows?: number;
}) {
  return (
    <div className="personnel-table-wrap" aria-hidden="true">
      <table className="personnel-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((column, columnIndex) => (
                <td key={`${column}-${columnIndex}`}>
                  <span
                    className={`loading-block ${
                      columnIndex === columns.length - 1 && columns.length > 4 ? "loading-block--pill" : "loading-block--md"
                    }`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LoadingCardList({ cards = 3 }: { cards?: number }) {
  return (
    <div className="metrics-team-list" aria-hidden="true">
      {Array.from({ length: cards }, (_, index) => (
        <article key={index} className="metrics-card">
          <div className="metrics-card__header">
            <div className="loading-stack">
              <span className="loading-block loading-block--sm" />
              <span className="loading-block loading-block--lg" />
            </div>
            <span className="loading-block loading-block--pill" />
          </div>

          <div className="loading-stack">
            <span className="loading-block loading-block--lg" />
            <span className="loading-block loading-block--lg" />
            <span className="loading-block loading-block--lg" />
          </div>
        </article>
      ))}
    </div>
  );
}

export function LoadingMetricsGrid({ sections = 4 }: { sections?: number }) {
  return (
    <div className="metrics-grid" aria-hidden="true">
      {Array.from({ length: sections }, (_, index) => (
        <section key={index} className="metrics-section">
          <div className="metrics-section__header">
            <div className="metrics-section__title-group">
              <span className="loading-block loading-block--lg" />
              <span className="loading-block loading-block--sm" />
            </div>
            <div className="metrics-window-toggle">
              <span className="loading-block loading-block--pill" />
              <span className="loading-block loading-block--pill" />
              <span className="loading-block loading-block--pill" />
            </div>
          </div>
          <LoadingCardList cards={2} />
        </section>
      ))}
    </div>
  );
}

export function LoadingProfileCards({ cards = 4, pills = 4 }: { cards?: number; pills?: number }) {
  return (
    <>
      <div className="profile-grid" aria-hidden="true">
        {Array.from({ length: cards }, (_, index) => (
          <div key={index} className="profile-card">
            <span className="profile-label">Loading</span>
            <span className="loading-block loading-block--md" />
          </div>
        ))}
      </div>

      <div className="profile-section" aria-hidden="true">
        <span className="profile-label">Qualified competencies</span>
        <div className="table-pills">
          {Array.from({ length: pills }, (_, index) => (
            <span key={index} className="loading-block loading-block--pill" />
          ))}
        </div>
      </div>
    </>
  );
}
