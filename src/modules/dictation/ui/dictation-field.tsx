"use client";

import * as React from "react";
import { DictationButton } from "./dictation-button";

/**
 * A long text field with the same dictation as the chat: a small microphone under the field; what is
 * said is added after the text already there (never replacing it, never sending the form), for the
 * person to read and edit. While it records, the recording bar takes the line.
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
  const [recording, setRecording] = React.useState(false);
  if (!enabled) return <>{children}</>;
  return (
    <div className="space-y-1.5">
      {children}
      <div className="flex min-h-8 items-center">
        <div data-dictation className={recording ? "flex min-w-0 flex-1" : "ml-auto"}>
          <DictationButton
            onRecordingChange={setRecording}
            onText={(text) => onChange(value && !/\s$/.test(value) ? `${value} ${text}` : value + text)}
          />
        </div>
      </div>
    </div>
  );
}
