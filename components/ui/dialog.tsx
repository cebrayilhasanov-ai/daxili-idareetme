"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"

const RESIZE_EDGES: ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"]
const MIN_DIALOG_WIDTH = 480
const MIN_DIALOG_HEIGHT = 320

const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

function placeDialog(el: HTMLElement, left: number, top: number, width: number, height: number) {
  el.style.setProperty("left", `${left}px`, "important")
  el.style.setProperty("top", `${top}px`, "important")
  el.style.setProperty("width", `${width}px`, "important")
  el.style.setProperty("height", `${height}px`, "important")
}

// Pins the dialog to explicit pixels (dropping the CSS centering) so an edge or the whole window can follow the pointer.
function pinDialog(el: HTMLElement) {
  const rect = el.getBoundingClientRect()
  el.dataset.resized = "true"
  for (const property of ["transform", "translate"]) el.style.setProperty(property, "none", "important")
  el.style.setProperty("max-width", "none", "important")
  el.style.setProperty("max-height", "none", "important")
  placeDialog(el, rect.left, rect.top, rect.width, rect.height)
  return rect
}

function DialogResizeHandle({ edge }: { edge: ResizeEdge }) {
  const drag = React.useRef<{ x: number; y: number; rect: DOMRect } | null>(null)

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = event.currentTarget.closest<HTMLElement>("[data-slot=dialog-content]")
    if (!el || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, rect: pinDialog(el) }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    const el = event.currentTarget.closest<HTMLElement>("[data-slot=dialog-content]")
    if (!state || !el) return
    const { rect } = state
    const dx = event.clientX - state.x
    const dy = event.clientY - state.y
    const clamp = clampNumber
    let left = rect.left
    let top = rect.top
    let width = rect.width
    let height = rect.height
    if (edge.includes("e")) width = clamp(rect.width + dx, MIN_DIALOG_WIDTH, window.innerWidth - rect.left)
    if (edge.includes("w")) {
      width = clamp(rect.width - dx, MIN_DIALOG_WIDTH, rect.right)
      left = rect.right - width
    }
    if (edge.includes("s")) height = clamp(rect.height + dy, MIN_DIALOG_HEIGHT, window.innerHeight - rect.top)
    if (edge.includes("n")) {
      height = clamp(rect.height - dy, MIN_DIALOG_HEIGHT, rect.bottom)
      top = rect.bottom - height
    }
    placeDialog(el, left, top, width, height)
  }

  const onPointerUp = () => {
    drag.current = null
  }

  return (
    <div
      className="dialogresizehandle"
      data-edge={edge}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  resizable = false,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  resizable?: boolean
}) {
  // A resizable dialog can also be moved by dragging its header, like a window title bar.
  const move = React.useRef<{ x: number; y: number; rect: DOMRect } | null>(null)
  const onMoveStart = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (event.button !== 0 || window.innerWidth <= 700 || !target.closest("[data-slot=dialog-header]") || target.closest("button,a,input,select,textarea")) return
    const el = event.currentTarget.closest<HTMLElement>("[data-slot=dialog-content]")
    if (!el) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    move.current = { x: event.clientX, y: event.clientY, rect: pinDialog(el) }
  }
  const onMoveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = move.current
    const el = event.currentTarget.closest<HTMLElement>("[data-slot=dialog-content]")
    if (!state || !el) return
    const { rect } = state
    // Keep a strip of the header on screen so the window can always be grabbed back.
    const left = clampNumber(rect.left + event.clientX - state.x, 100 - rect.width, window.innerWidth - 100)
    const top = clampNumber(rect.top + event.clientY - state.y, 0, window.innerHeight - 60)
    placeDialog(el, left, top, rect.width, rect.height)
  }
  const onMoveEnd = () => {
    move.current = null
  }
  const closeButton = showCloseButton && (
    <DialogPrimitive.Close
      data-slot="dialog-close"
      className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
    >
      <XIcon />
      <span className="sr-only">Close</span>
    </DialogPrimitive.Close>
  )
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-resizable={resizable ? "true" : undefined}
        className={cn(
          "fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg",
          className
        )}
        {...props}
      >
        {resizable ? (
          <>
            <div className="dialogresizebody" onPointerDown={onMoveStart} onPointerMove={onMoveDrag} onPointerUp={onMoveEnd} onPointerCancel={onMoveEnd}>
              {children}
              {closeButton}
            </div>
            {RESIZE_EDGES.map((edge) => (
              <DialogResizeHandle key={edge} edge={edge} />
            ))}
          </>
        ) : (
          <>
            {children}
            {closeButton}
          </>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
