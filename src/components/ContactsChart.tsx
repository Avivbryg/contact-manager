import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6366f1', '#14b8a6', '#f43f5e', '#84cc16', '#64748b'];

interface ContactsChartProps {
  data: { name: string; value: number }[];
}

// Loaded lazily: recharts is a large share of the bundle and the chart is optional
export default function ContactsChart({ data }: ContactsChartProps) {
  return (
    <>
      <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%" dir="ltr">
              <PieChart>
                  <Pie
                      data={data}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                  >
                      {data.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                  </Pie>
                  <Tooltip
                      formatter={(value: number) => [value, '']}
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
              </PieChart>
          </ResponsiveContainer>
      </div>
      <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs">
          {data.map((entry, index) => (
              <div key={index} className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
                  <span className="text-slate-600">{entry.name} ({entry.value})</span>
              </div>
          ))}
      </div>
    </>
  );
}
