"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "#d4edda", // Light green for success background
          "--success-text": "#155724", // Dark green for success text
          "--success-border": "#c3e6cb", // Border for success
        } as React.CSSProperties
      }
      {...props}
      toastOptions={{
        classNames: {
          success: "bg-green-200 text-green-800 border-green-400",
        },
      }}
    />
  )
}

export { Toaster }
