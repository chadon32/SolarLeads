import Link from "next/link";
import type { ButtonHTMLAttributes, AnchorHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";

type CommonProps = {
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
};

type ButtonProps = CommonProps & ButtonHTMLAttributes<HTMLButtonElement>;
type ButtonLinkProps = CommonProps & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

const baseClasses =
  "inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-60";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-cyan-300 text-slate-950 shadow-[0_18px_50px_rgba(34,211,238,0.18)] hover:-translate-y-0.5 hover:bg-cyan-200",
  secondary:
    "border border-white/10 bg-white/5 text-slate-100 shadow-[0_12px_40px_rgba(2,8,20,0.28)] backdrop-blur-md hover:-translate-y-0.5 hover:bg-white/10",
  ghost:
    "border border-cyan-300/15 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/15",
};

export function Button({
  variant = "primary",
  className = "",
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${baseClasses} ${variantClasses[variant]} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "primary",
  className = "",
  children,
  href,
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      href={href}
      className={`${baseClasses} ${variantClasses[variant]} ${className}`.trim()}
      {...props}
    >
      {children}
    </Link>
  );
}
