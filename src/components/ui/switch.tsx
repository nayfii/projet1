"use client";

import * as React from "react";
import { Switch as GlassSwitch } from "glisse";
import { cn } from "@/lib/utils";

type SwitchProps = Omit<React.ComponentProps<typeof GlassSwitch>, "value"> & {
  /** Sent with its form when on, like a checkbox ("on" by default). */
  name?: string;
  value?: string;
};

/**
 * On/off control: glisse's Liquid Glass switch (a lens that lifts while held or dragged, springs
 * back on release; role="switch" with aria-checked). Inside a form, a `name` sends `value` when on,
 * as a checkbox does.
 */
function Switch({ className, name, value = "on", checked, defaultChecked, onCheckedChange, ...props }: SwitchProps) {
  const [inner, setInner] = React.useState(defaultChecked ?? false);
  const isOn = checked ?? inner;
  return (
    <>
      <GlassSwitch
        className={cn("app-switch", className)}
        checked={isOn}
        onCheckedChange={(next) => {
          if (checked === undefined) setInner(next);
          onCheckedChange?.(next);
        }}
        {...props}
      />
      {name && isOn ? <input type="hidden" name={name} value={value} /> : null}
    </>
  );
}

export { Switch };
