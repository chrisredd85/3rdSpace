import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-forest-500/10 disabled:pointer-events-none disabled:opacity-50 min-h-[44px]",
  {
    variants: {
      variant: {
        default: "bg-forest-500 text-white hover:bg-forest-600 shadow-lg shadow-forest-500/20 hover:shadow-xl hover:shadow-forest-500/30 hover:scale-105 active:scale-95",
        destructive:
          "bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/20 hover:shadow-xl hover:shadow-red-500/30 hover:scale-105 active:scale-95",
        outline:
          "border-2 border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 active:scale-95",
        secondary:
          "bg-slate-100 text-slate-900 hover:bg-slate-200 active:scale-95",
        ghost: "hover:bg-slate-100 text-slate-700 active:scale-95",
        link: "text-forest-500 underline-offset-4 hover:underline hover:text-forest-600",
      },
      size: {
        default: "h-11 px-6 py-3 rounded-xl text-base",
        sm: "h-10 px-4 py-2 rounded-lg text-sm min-h-[44px] sm:min-h-[40px]",
        lg: "h-12 px-8 py-3 rounded-xl text-lg",
        icon: "h-11 w-11 rounded-xl min-h-[44px] min-w-[44px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
