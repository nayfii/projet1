"use client";

import * as React from "react";
import { DropdownMenu as MenuPrimitive } from "radix-ui";
import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { LiquidGlass } from "./liquid-glass";

const DropdownMenu = MenuPrimitive.Root;
const DropdownMenuTrigger = MenuPrimitive.Trigger;
const DropdownMenuGroup = MenuPrimitive.Group;
const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

function DropdownMenuContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      {/* A pane of Liquid Glass: its rim bends what is behind the menu. */}
      <MenuPrimitive.Content sideOffset={sideOffset} asChild {...props}>
        <LiquidGlass
          material="solid"
          reach={16}
          className={cn(
            "z-50 min-w-48 overflow-hidden rounded-[14px] border p-1 text-popover-foreground",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97] data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            className,
          )}
        >
          {children}
        </LiquidGlass>
      </MenuPrimitive.Content>
    </MenuPrimitive.Portal>
  );
}

const itemBase =
  "relative flex cursor-default select-none items-center gap-2 rounded-[9px] px-2 py-1.5 text-sm outline-none transition-colors duration-[var(--dur-micro)] focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted-foreground";

function DropdownMenuItem({
  className,
  destructive,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Item> & { destructive?: boolean }) {
  return (
    <MenuPrimitive.Item
      className={cn(itemBase, destructive && "text-destructive focus:bg-destructive-soft [&_svg]:text-destructive", className)}
      {...props}
    />
  );
}

function DropdownMenuRadioItem({ className, children, ...props }: React.ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem className={cn(itemBase, "pr-8", className)} {...props}>
      {children}
      <MenuPrimitive.ItemIndicator className="absolute right-2 flex items-center">
        <CheckIcon />
      </MenuPrimitive.ItemIndicator>
    </MenuPrimitive.RadioItem>
  );
}

function DropdownMenuCheckboxItem({ className, children, ...props }: React.ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem className={cn(itemBase, "pr-8", className)} {...props}>
      {children}
      <MenuPrimitive.ItemIndicator className="absolute right-2 flex items-center">
        <CheckIcon />
      </MenuPrimitive.ItemIndicator>
    </MenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof MenuPrimitive.Label>) {
  return <MenuPrimitive.Label className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)} {...props} />;
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
};
