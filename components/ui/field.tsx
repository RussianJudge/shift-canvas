import { useId } from "react";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

function classNames(...values: (string | false | undefined)[]) {
  return values.filter(Boolean).join(" ");
}

type FieldShellProps = {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  className?: string;
  children: (props: {
    id: string;
    describedBy: string | undefined;
    invalid: boolean;
  }) => ReactNode;
};

/**
 * Owns the label/description/error wiring so every control gets the same
 * accessible names and the same aria-describedby chain.
 */
export function Field({
  label,
  hint,
  error,
  optional = false,
  className,
  children,
}: FieldShellProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    classNames(hint && hintId, error && errorId) || undefined;

  return (
    <div className={classNames("ui-field", className)}>
      <label className="ui-field__label" htmlFor={id}>
        {label}
        {optional ? <span className="ui-field__optional">Optional</span> : null}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint ? (
        <span className="ui-field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="ui-field__error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  fieldClassName?: string;
};

export function TextInput({
  label,
  hint,
  error,
  optional,
  fieldClassName,
  className,
  type = "text",
  ...rest
}: TextInputProps) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      className={fieldClassName}
    >
      {({ id, describedBy, invalid }) => (
        <input
          {...rest}
          id={id}
          type={type}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={classNames("ui-input", className)}
        />
      )}
    </Field>
  );
}

type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> & {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  fieldClassName?: string;
};

export function TextArea({
  label,
  hint,
  error,
  optional,
  fieldClassName,
  className,
  ...rest
}: TextAreaProps) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      className={fieldClassName}
    >
      {({ id, describedBy, invalid }) => (
        <textarea
          {...rest}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={classNames("ui-input", "ui-input--textarea", className)}
        />
      )}
    </Field>
  );
}

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> & {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  fieldClassName?: string;
  children: ReactNode;
};

export function Select({
  label,
  hint,
  error,
  optional,
  fieldClassName,
  className,
  children,
  ...rest
}: SelectProps) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      className={fieldClassName}
    >
      {({ id, describedBy, invalid }) => (
        <select
          {...rest}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={classNames("ui-select", className)}
        >
          {children}
        </select>
      )}
    </Field>
  );
}
