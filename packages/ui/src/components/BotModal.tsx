import type { Component, InteractionModal, SelectComponent, TextInputComponent } from "@minicord/core";
import { useState } from "react";
import { useClient } from "../app/context.tsx";
import { Button } from "./ui.tsx";

interface Field {
  label?: string | undefined;
  description?: string | undefined;
  input: TextInputComponent | SelectComponent;
}

/** Flatten a modal's rows (and newer label wrappers) into labelled inputs. */
function fieldsOf(components: Component[]): Field[] {
  const out: Field[] = [];
  const visit = (c: Component, label?: string, description?: string) => {
    if (c.type === 1) for (const child of c.components) visit(child);
    else if (c.type === 18) visit(c.component, c.label, c.description);
    else if (c.type === 4) out.push({ label: label ?? c.label, input: c, ...(description ? { description } : {}) });
    else if (c.type === 3) out.push({ label, input: c, ...(description ? { description } : {}) });
  };
  for (const c of components) visit(c);
  return out;
}

/** A form a bot opened for you (INTERACTION_MODAL_CREATE). */
export function BotModal({ modal }: { modal: InteractionModal }) {
  const client = useClient();
  const fields = fieldsOf(modal.components);
  const [values, setValues] = useState<Record<string, string | string[]>>(() =>
    Object.fromEntries(
      fields.map((f) => [f.input.custom_id, f.input.type === 4 ? (f.input.value ?? "") : (f.input.options ?? []).filter((o) => o.default).map((o) => o.value)]),
    ),
  );
  const missing = fields.some((f) => {
    const v = values[f.input.custom_id];
    const required = f.input.type === 4 ? f.input.required !== false : (f.input.min_values ?? 1) > 0 && f.input.required !== false;
    return required && (Array.isArray(v) ? !v.length : !String(v ?? "").trim());
  });
  const field = "w-full rounded-md bg-sunken px-3 py-2 text-[14.5px] outline-none focus:ring-2 focus:ring-accent/40";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => client.closeOverlay()}>
      <form
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (missing) return;
          client.closeOverlay();
          client.submitModal(modal, values);
        }}
      >
        <div className="px-5 pb-2 pt-5">
          <div className="text-[12px] font-medium text-muted">{modal.application.name}</div>
          <h3 className="text-[18px] font-semibold">{modal.title}</h3>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-3">
          {fields.map((f) => {
            const id = f.input.custom_id;
            return (
              <label key={id} className="block">
                <span className="mb-1 block text-[12px] font-semibold uppercase tracking-wide text-muted">{f.label}</span>
                {f.description && <span className="mb-1 block text-[12.5px] text-muted">{f.description}</span>}
                {f.input.type === 4 ? (
                  f.input.style === 2 ? (
                    <textarea
                      value={String(values[id] ?? "")}
                      onChange={(e) => setValues((v) => ({ ...v, [id]: e.target.value }))}
                      placeholder={f.input.placeholder}
                      maxLength={f.input.max_length}
                      rows={4}
                      className={`${field} resize-y`}
                    />
                  ) : (
                    <input
                      value={String(values[id] ?? "")}
                      onChange={(e) => setValues((v) => ({ ...v, [id]: e.target.value }))}
                      placeholder={f.input.placeholder}
                      maxLength={f.input.max_length}
                      className={field}
                    />
                  )
                ) : (
                  <select
                    multiple={(f.input.max_values ?? 1) > 1}
                    value={values[id] as string[]}
                    onChange={(e) => setValues((v) => ({ ...v, [id]: [...e.target.selectedOptions].map((o) => o.value) }))}
                    className={field}
                  >
                    {(f.input.max_values ?? 1) <= 1 && <option value="">{f.input.placeholder ?? "Choose…"}</option>}
                    {(f.input.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            );
          })}
        </div>
        <div className="flex justify-end gap-2 bg-bg px-5 py-3">
          <Button type="button" tone="quiet" onClick={() => client.closeOverlay()}>
            Cancel
          </Button>
          <Button type="submit" tone="accent" disabled={missing}>
            Submit
          </Button>
        </div>
      </form>
    </div>
  );
}
