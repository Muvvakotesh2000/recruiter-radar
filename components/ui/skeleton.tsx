import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg shimmer bg-secondary/80", className)}
      {...props}
    />
  );
}

export { Skeleton };
