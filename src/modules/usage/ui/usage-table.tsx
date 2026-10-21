import { Card } from "@/components/ui/card";

/** A simple figures table: the first column is a label, the others are right-aligned numbers. */
export function UsageTable({ title, headers, rows }: { title?: string; headers: string[]; rows: { key: string; cells: React.ReactNode[] }[] }) {
  return (
    <div className="space-y-3">
      {title ? <h2 className="text-sm font-medium">{title}</h2> : null}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-[13px] text-muted-foreground">
              {headers.map((h, i) => (
                <th key={h} className={i === 0 ? "px-4 py-2.5 font-medium" : "whitespace-nowrap px-4 py-2.5 text-right font-medium"}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.key}>
                {r.cells.map((c, i) => (
                  <td key={i} className={i === 0 ? "max-w-56 truncate px-4 py-2.5" : "whitespace-nowrap px-4 py-2.5 text-right tabular-nums"}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
