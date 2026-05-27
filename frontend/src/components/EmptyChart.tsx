// Visual placeholder displayed in lieu of an empty Recharts plot so users
// understand the area is intentionally blank, not broken.
export function EmptyChart({ message = 'Pas encore de données à afficher.' }: { message?: string }) {
  return (
    <div className="chart-empty">
      <span>{message}</span>
    </div>
  );
}
