"use client";
import { X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ className, children, title, description, ...props }: React.ComponentProps<typeof D.Content> & {
  title: string; description?: string;
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
      <D.Content
        className={cn("fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-xl", className)}
        {...props}>
        <div className="mb-4 pr-8">
          <D.Title className="text-base font-semibold tracking-tight">{title}</D.Title>
          {description ? <D.Description className="mt-1 text-[13px] text-ink-3">{description}</D.Description> : null}
        </div>
        {children}
        <D.Close className="absolute right-4 top-4 rounded-md p-1 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Close">
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}
