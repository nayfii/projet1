"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { DictationButton } from "./dictation-button";
import { LiveDictation } from "./live-dictation";

/**
 * A long text field with the same dictation as the chat: a small microphone under the field; what is
 * said is added after the text already there (never replacing it, never sending the form), for the
 * person to read and edit. While it records, the recording bar takes the line and what is said so
 * far shows above it.
 */
export function DictationField({
  enabled,
  value,
  onChange,
  children,
}: {
  /** Dictation is on for the company. */
  enabled: boolean;
  value: string;
  onChange: (value: string) => void;
  /** The field itself (a Textarea). */
  children: React.ReactNode;
}) {
  const t = useTranslations("dictation");
  const [recording, setRecording] = React.useState(false);
  const [live, setLive] = React.useState("");
  // The field as the last dictation left it (the polished version may only replace an untouched text).
  const dictated = React.useRef<string | null>(null);
  if (!enabled) return <>{children}</>;
  return (
    <div className="space-y-1.5">
      {children}
      {live ? <LiveDictation text={live} label={t("live")} /> : null}
      <div className="flex min-h-8 items-center">
        <div data-dictation className={recording ? "flex min-w-0 flex-1" : "ml-auto"}>
          <DictationButton
            onRecordingChange={setRecording}
            onLive={setLive}
            onText={(text) => {
              const next = value && !/\s$/.test(value) ? `${value} ${text}` : value + text;
              dictated.current = next;
              onChange(next);
            }}
            onReplace={(from, to, auto = false) => {
              if (auto && value !== dictated.current) return false;
              const at = value.lastIndexOf(from);
              if (at < 0) return false;
              const next = value.slice(0, at) + to + value.slice(at + from.length);
              if (auto) dictated.current = next;
              onChange(next);
              return true;
            }}
          />
        </div>
      </div>
    </div>
  );
}
