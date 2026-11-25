import { AlertTriangle, CheckCircle2, Loader2, ScanLine, XCircle } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { QrScanner } from '@/components/QrScanner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError, type Attendee } from '@/lib/api';

type Result =
  | { kind: 'idle' }
  | { kind: 'pending'; code: string }
  | { kind: 'checked-in'; attendee: Attendee }
  | { kind: 'already'; attendee: Attendee }
  | { kind: 'error'; title: string; detail: string; reauth?: boolean };

const time = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

const normalize = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

export function Scanner() {
  const [result, setResult] = useState<Result>({ kind: 'idle' });
  const [manual, setManual] = useState('');
  const busy = useRef(false);
  const last = useRef<{ code: string; at: number } | null>(null);

  async function checkIn(raw: string) {
    const code = normalize(raw);
    if (code.length !== 8 || busy.current) return;

    const now = Date.now();
    // The camera re-decodes the same code every frame, valid or not: re-check it at most once per 5s.
    if (last.current?.code === code && now - last.current.at < 5000) return;
    last.current = { code, at: now };
    busy.current = true;
    setResult({ kind: 'pending', code });

    try {
      const response = await api.checkin(code);
      setResult({ kind: response.status, attendee: response.attendee });
      navigator.vibrate?.(response.status === 'checked-in' ? 55 : [35, 60, 35]);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      setResult({
        kind: 'error',
        title:
          status === 401
            ? 'Session expired'
            : status === 403
              ? 'Not allowed'
              : status === 404
                ? 'Ticket not found'
                : 'Check-in failed',
        detail: error instanceof ApiError ? error.message : 'Could not reach the server. Try again.',
        reauth: status === 401,
      });
      navigator.vibrate?.([35, 60, 35]);
    } finally {
      busy.current = false;
    }
  }

  function handleManual(event: FormEvent) {
    event.preventDefault();
    if (!manual.trim()) return;
    void checkIn(manual);
    setManual('');
  }

  return (
    <div className="grid animate-rise gap-4 lg:grid-cols-[1.05fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Scan a ticket</CardTitle>
          <CardDescription>Hold the QR code inside the frame.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <QrScanner onDecode={(text) => void checkIn(text)} />

          <form onSubmit={handleManual} className="grid gap-2">
            <Label htmlFor="manual-code">Or type the code</Label>
            <div className="flex gap-2">
              <Input
                id="manual-code"
                value={manual}
                onChange={(event) => setManual(event.target.value)}
                placeholder="A1B2C3D4"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="font-mono tracking-[0.12em] uppercase"
              />
              <Button type="submit" variant="outline" disabled={!manual.trim()}>
                Check in
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <ResultPanel result={result} />
    </div>
  );
}

function ResultPanel({ result }: { result: Result }) {
  return (
    <div aria-live="polite" className="min-h-[280px] self-start">
      {result.kind === 'idle' && (
        <div className="grid h-full place-items-center rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center">
          <div>
            <ScanLine className="mx-auto size-6 text-muted-foreground" aria-hidden />
            <p className="mt-3 text-[15px] font-medium">Ready when you are</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Scanning starts automatically.
            </p>
          </div>
        </div>
      )}

      {result.kind === 'pending' && (
        <div className="grid place-items-center rounded-xl border border-border bg-card p-10 text-center">
          <div>
            <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" aria-hidden />
            <p className="mt-3 font-mono text-[15px] tracking-[0.12em]">{result.code}</p>
          </div>
        </div>
      )}

      {(result.kind === 'checked-in' || result.kind === 'already') && (
        <div className="animate-rise rounded-xl border border-border bg-card p-6 shadow-[0_1px_2px_oklch(0.235_0.012_268/0.04),0_10px_30px_-24px_oklch(0.235_0.012_268/0.35)]">
          <div
            className={
              result.kind === 'checked-in'
                ? 'grid size-11 place-items-center rounded-full bg-success/10 text-success'
                : 'grid size-11 place-items-center rounded-full bg-warning/15 text-[oklch(0.5_0.11_72)]'
            }
          >
            {result.kind === 'checked-in' ? (
              <CheckCircle2 className="size-5" aria-hidden />
            ) : (
              <AlertTriangle className="size-5" aria-hidden />
            )}
          </div>

          <p className="mt-4 text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
            {result.kind === 'checked-in' ? 'Checked in' : 'Already checked in'}
          </p>
          <p className="mt-1.5 text-[20px] leading-tight font-semibold tracking-[-0.01em]">
            {result.attendee.fullName}
          </p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{result.attendee.organization}</p>
          {result.attendee.eventName && (
            <p className="mt-1 text-[12px] text-muted-foreground">{result.attendee.eventName}</p>
          )}

          <dl className="mt-5 grid gap-2 border-t border-border/70 pt-4 text-[13px]">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Ticket</dt>
              <dd className="font-mono tracking-[0.1em] tabular-nums">{result.attendee.code}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">
                {result.kind === 'checked-in' ? 'Time' : 'First check-in'}
              </dt>
              <dd className="tabular-nums">{time.format(new Date(result.attendee.checkedInAt!))}</dd>
            </div>
          </dl>
        </div>
      )}

      {result.kind === 'error' && (
        <div className="animate-rise rounded-xl border border-border bg-card p-6">
          <div className="grid size-11 place-items-center rounded-full bg-destructive/10 text-destructive">
            <XCircle className="size-5" aria-hidden />
          </div>
          <p className="mt-4 text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
            Not checked in
          </p>
          <p className="mt-1.5 text-[20px] leading-tight font-semibold tracking-[-0.01em]">
            {result.title}
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{result.detail}</p>
          {result.reauth && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => window.location.assign('/staff')}
            >
              Sign in again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
