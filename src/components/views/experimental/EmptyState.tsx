interface EmptyStateProps {
  title: string;
  hint: string;
}

export function EmptyState({ title, hint }: EmptyStateProps) {
  return (
    <div className="h-full flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
      <div className="max-w-sm text-center">
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{title}</p>
        <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">{hint}</p>
      </div>
    </div>
  );
}
