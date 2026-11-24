import { ArrowRight, Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError, type RegisterInput, type RegisterResult } from '@/lib/api';
import { cn } from '@/lib/utils';

type Values = RegisterInput;
type Field = keyof Values;

const EMPTY: Values = { fullName: '', email: '', organization: '', phone: '' };

const FIELDS: {
  name: Field;
  label: string;
  type: string;
  autoComplete: string;
  placeholder: string;
  inputMode?: 'email' | 'tel';
  wide?: boolean;
}[] = [
  {
    name: 'fullName',
    label: 'Full name',
    type: 'text',
    autoComplete: 'name',
    placeholder: 'Ada Lovelace',
    wide: true,
  },
  {
    name: 'email',
    label: 'Email address',
    type: 'email',
    autoComplete: 'email',
    placeholder: 'ada@example.com',
    inputMode: 'email',
    wide: true,
  },
  {
    name: 'organization',
    label: 'Organization',
    type: 'text',
    autoComplete: 'organization',
    placeholder: 'Analytical Engines',
  },
  {
    name: 'phone',
    label: 'Contact number',
    type: 'tel',
    autoComplete: 'tel',
    placeholder: '+60 12 345 6789',
    inputMode: 'tel',
  },
];

function validate(values: Values) {
  const errors: Partial<Record<Field, string>> = {};
  if (values.fullName.trim().length < 2) errors.fullName = 'Enter your full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email.trim()))
    errors.email = 'Enter a valid email address.';
  if (values.organization.trim().length < 2) errors.organization = 'Enter your organization.';
  if (!/^[+()\d][\d\s()+-]{6,19}$/.test(values.phone.trim()))
    errors.phone = 'Enter a valid contact number.';
  return errors;
}

export function RegisterForm({
  eventId,
  onSuccess,
}: {
  eventId: number;
  onSuccess: (result: RegisterResult) => void;
}) {
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update(name: Field, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
    if (errors[name]) setErrors((current) => ({ ...current, [name]: undefined }));
  }

  function validateField(name: Field) {
    const message = validate(values)[name];
    setErrors((current) => ({ ...current, [name]: message }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const found = validate(values);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      const first = FIELDS.find((field) => found[field.name]);
      if (first) document.getElementById(`field-${first.name}`)?.focus();
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      onSuccess(
        await api.register(eventId, {
          fullName: values.fullName.trim(),
          email: values.email.trim(),
          organization: values.organization.trim(),
          phone: values.phone.trim(),
        }),
      );
    } catch (error) {
      setFormError(
        error instanceof ApiError
          ? error.message
          : 'Could not reach the server. Check your connection and try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="animate-rise-slow rounded-xl border border-border bg-card p-5 shadow-[0_1px_2px_oklch(0.235_0.012_268/0.04),0_10px_30px_-24px_oklch(0.235_0.012_268/0.35)] sm:p-7"
    >
        <div className="grid gap-5 sm:grid-cols-2">
          {FIELDS.map((field) => {
            const error = errors[field.name];
            return (
              <div key={field.name} className={cn('grid gap-2', field.wide && 'sm:col-span-2')}>
                <Label htmlFor={`field-${field.name}`}>{field.label}</Label>
                <Input
                  id={`field-${field.name}`}
                  name={field.name}
                  type={field.type}
                  autoComplete={field.autoComplete}
                  inputMode={field.inputMode}
                  placeholder={field.placeholder}
                  value={values[field.name]}
                  onChange={(event) => update(field.name, event.target.value)}
                  onBlur={() => validateField(field.name)}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `error-${field.name}` : undefined}
                />
                {error && (
                  <p id={`error-${field.name}`} className="text-[12.5px] leading-none text-destructive">
                    {error}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {formError && (
          <p
            role="alert"
            className="mt-5 rounded-lg border border-destructive/20 bg-destructive/5 px-3.5 py-2.5 text-[13px] leading-relaxed text-destructive"
          >
            {formError}
          </p>
        )}

        <div className="mt-6 grid gap-3">
          <Button type="submit" size="lg" disabled={submitting} className="w-full">
            {submitting ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                Creating your ticket…
              </>
            ) : (
              <>
                Get my QR ticket
                <ArrowRight aria-hidden />
              </>
            )}
          </Button>
          <p className="text-center text-xs leading-relaxed text-muted-foreground">
            Used only for your ticket and check-in.
          </p>
        </div>
      </form>
  );
}
