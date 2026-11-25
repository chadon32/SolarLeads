import { comparisonCsv, type LeadPeriodComparison } from "@/lib/lead-period-comparison";

const dates = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const range = ({ start, end }: { start: string; end: string }) =>
  dates.formatRange(new Date(start + "T12:00:00Z"), new Date(end + "T12:00:00Z"));

export function DashboardPeriodComparison({ data }: { data: LeadPeriodComparison }) {
  return <section className="crm-panel crm-comparison" aria-labelledby="crm-period-comparison-title">
    <div className="crm-panel-heading">
      <div>
        <h2 id="crm-period-comparison-title">Submission pace</h2>
        <p>{data.mode === "comparison" ? `Last ${data.days} completed Phoenix days versus the ${data.days} before them. Today is excluded.`
          : "Compare submissions and installer contact requests across two equal periods."}</p>
      </div>
    </div>
    {data.mode !== "comparison" ? <p className="crm-empty">{data.mode === "all"
      ? "Choose 7, 30, or 90 days in Submission period to compare completed periods."
      : "The dashboard snapshot date is unavailable. Refresh before comparing periods."}</p> : <>
      <dl className="crm-comparison-ranges">
        <div><dt>Recent</dt><dd>{range(data.recent)}</dd></div>
        <div><dt>Previous</dt><dd>{range(data.previous)}</dd></div>
      </dl>
      <table className="crm-comparison-table" aria-label="Lead submissions and contact requests by period">
        <thead><tr><th scope="col">Measure</th><th scope="col">Recent</th><th scope="col">Previous</th><th scope="col">Change</th></tr></thead>
        <tbody>{data.rows.map(row => <tr key={row.label}>
          <th scope="row">{row.label}</th>
          <td>{row.recent ?? "N/A"}</td><td>{row.previous ?? "N/A"}</td>
          <td>{row.change === null ? "N/A" : row.change > 0 ? `+${row.change}` : row.change}</td>
        </tr>)}</tbody>
      </table>
      {(!data.recentCovered || !data.previousCovered) && <p className="crm-comparison-note">
        {data.unplaceable ? "N/A: some included records have no usable submission date." : "N/A: the loaded history does not cover the full period."} Changes require both periods.
      </p>}
      <div className="crm-comparison-footer">
        <p>Change is a count, not a conversion rate. {data.includeTests ? "Test leads included." : "Test leads excluded."}</p>
        <a className="crm-button crm-button-secondary" download={`solartelligence-submission-pace-${data.days}d-${data.recent.end}.csv`}
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(comparisonCsv(data))}`}>Download comparison CSV</a>
      </div>
    </>}
  </section>;
}
