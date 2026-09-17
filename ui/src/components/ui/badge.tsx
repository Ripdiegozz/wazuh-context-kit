import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "border-border text-foreground",
        derived: "border-transparent text-black" ,
        assertion: "border-transparent text-black",
        annotation: "border-transparent text-black",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.ComponentProps<"span">,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, style, ...props }: BadgeProps) {
  const domainStyle: React.CSSProperties | undefined =
    variant === "derived"
      ? { backgroundColor: "var(--evidence-derived)" }
      : variant === "assertion"
        ? { backgroundColor: "var(--evidence-assertion)" }
        : variant === "annotation"
          ? { backgroundColor: "var(--evidence-annotation)" }
          : undefined;

  return (
    <span
      className={cn(badgeVariants({ variant, className }))}
      style={{ ...domainStyle, ...style }}
      {...props}
    />
  );
}

export { badgeVariants };
