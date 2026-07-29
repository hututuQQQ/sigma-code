"use client";

import { useAtomValue } from "@effect/atom-react";
import {
  CheckCircle2Icon,
  CopyIcon,
  ExternalLinkIcon,
  LoaderIcon,
  LogInIcon,
  LogOutIcon,
} from "lucide-react";
import type {
  EnvironmentId,
  ProviderAuthLoginMethod,
  ProviderAuthOperationEvent,
  ProviderAuthOperationId,
  ProviderInstanceId,
  ServerProviderAuthConnection,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useEffect, useRef, useState } from "react";

import { readLocalApi } from "../../localApi";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";
import {
  isSafeProviderAuthExternalUrl,
  type ProviderModelAuthRequirement,
} from "../../providerAuth";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Authentication could not be completed.";
}

function AuthOperationWatcher(props: {
  readonly environmentId: EnvironmentId;
  readonly operationId: ProviderAuthOperationId;
  readonly onEvent: (event: ProviderAuthOperationEvent) => void;
}) {
  const result = useAtomValue(
    serverEnvironment.providerAuthOperation({
      environmentId: props.environmentId,
      input: { operationId: props.operationId },
    }),
  );

  useEffect(() => {
    if (AsyncResult.isSuccess(result)) {
      props.onEvent(result.value);
    }
  }, [props.onEvent, result]);

  return null;
}

export function ProviderAuthLoginFlow(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly connection: ServerProviderAuthConnection;
  readonly canStartLogin: boolean;
  readonly autoStart?: boolean;
  readonly onCompleted: () => void;
  readonly onCancel?: () => void;
}) {
  const startAuth = useAtomCommand(serverEnvironment.startProviderAuth, {
    reportFailure: false,
  });
  const respondAuth = useAtomCommand(serverEnvironment.respondProviderAuth, {
    reportFailure: false,
  });
  const cancelAuth = useAtomCommand(serverEnvironment.cancelProviderAuth, {
    reportFailure: false,
  });
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [operationId, setOperationId] = useState<ProviderAuthOperationId | null>(null);
  const [displayEvent, setDisplayEvent] = useState<ProviderAuthOperationEvent | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [responding, setResponding] = useState(false);
  const lastSequenceRef = useRef(-1);
  const terminalRef = useRef(false);
  const autoStartedRef = useRef(false);
  const operationIdRef = useRef<ProviderAuthOperationId | null>(null);
  const cancelAuthRef = useRef(cancelAuth);
  cancelAuthRef.current = cancelAuth;

  const openExternal = useCallback(async (url: string) => {
    if (!isSafeProviderAuthExternalUrl(url)) {
      setError("Sigma returned an invalid ChatGPT authentication URL.");
      return;
    }
    try {
      await readLocalApi()?.shell.openExternal(url);
    } catch {
      setError("Sigma Code could not open the system browser. Use the manual code prompt below.");
    }
  }, []);

  const start = useCallback(
    async (loginMethod: ProviderAuthLoginMethod) => {
      if (!props.canStartLogin || starting || operationId !== null) return;
      setStarting(true);
      setError(null);
      setDisplayEvent(null);
      lastSequenceRef.current = -1;
      terminalRef.current = false;
      const result = await startAuth({
        environmentId: props.environmentId,
        input: {
          instanceId: props.instanceId,
          connectionId: props.connection.id,
          loginMethod,
        },
      });
      setStarting(false);
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          setError(errorMessage(squashAtomCommandFailure(result)));
        }
        return;
      }
      operationIdRef.current = result.value.operationId;
      setOperationId(result.value.operationId);
    },
    [
      operationId,
      props.canStartLogin,
      props.connection.id,
      props.environmentId,
      props.instanceId,
      startAuth,
      starting,
    ],
  );

  useEffect(() => {
    if (
      props.autoStart &&
      props.canStartLogin &&
      !autoStartedRef.current &&
      props.connection.loginMethods.includes("browser")
    ) {
      autoStartedRef.current = true;
      void start("browser");
    }
  }, [props.autoStart, props.canStartLogin, props.connection.loginMethods, start]);

  useEffect(
    () => () => {
      const activeOperationId = operationIdRef.current;
      if (activeOperationId && !terminalRef.current) {
        void cancelAuthRef.current({
          environmentId: props.environmentId,
          input: { operationId: activeOperationId },
        });
      }
    },
    [props.environmentId],
  );

  const handleEvent = useCallback(
    (event: ProviderAuthOperationEvent) => {
      if (event.sequence <= lastSequenceRef.current) return;
      lastSequenceRef.current = event.sequence;
      setError(null);
      if (event.type === "auth_url") {
        setDisplayEvent({
          type: "progress",
          operationId: event.operationId,
          sequence: event.sequence,
          message: "Continue signing in in the system browser.",
        });
        void openExternal(event.url);
        return;
      }
      setDisplayEvent(event);
      if (event.type === "device_code") {
        void openExternal(event.verificationUri);
        return;
      }
      if (event.type === "input_required") {
        setInputValue("");
        return;
      }
      if (event.type === "error") {
        terminalRef.current = true;
        operationIdRef.current = null;
        setOperationId(null);
        setError(event.message);
        return;
      }
      if (event.type === "completed") {
        terminalRef.current = true;
        void (async () => {
          await refreshProviders({
            environmentId: props.environmentId,
            input: { instanceId: props.instanceId },
          });
          props.onCompleted();
        })();
      }
    },
    [openExternal, props, refreshProviders],
  );

  const respond = useCallback(async () => {
    if (
      operationId === null ||
      displayEvent?.type !== "input_required" ||
      inputValue.trim().length === 0 ||
      responding
    ) {
      return;
    }
    setResponding(true);
    const result = await respondAuth({
      environmentId: props.environmentId,
      input: {
        operationId,
        promptId: displayEvent.promptId,
        value: inputValue.trim(),
      },
    });
    setResponding(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      setError(errorMessage(squashAtomCommandFailure(result)));
      return;
    }
    setDisplayEvent({
      type: "progress",
      operationId,
      sequence: displayEvent.sequence,
      message: "Checking the authorization response…",
    });
    setInputValue("");
  }, [displayEvent, inputValue, operationId, props.environmentId, respondAuth, responding]);

  const cancel = useCallback(async () => {
    if (operationId !== null && !terminalRef.current) {
      terminalRef.current = true;
      await cancelAuth({
        environmentId: props.environmentId,
        input: { operationId },
      });
    }
    props.onCancel?.();
  }, [cancelAuth, operationId, props]);

  const canUseBrowser = props.connection.loginMethods.includes("browser");
  const canUseDeviceCode = props.connection.loginMethods.includes("device-code");
  return (
    <div className="space-y-3">
      {operationId ? (
        <AuthOperationWatcher
          environmentId={props.environmentId}
          operationId={operationId}
          onEvent={handleEvent}
        />
      ) : null}

      {!props.canStartLogin ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Sign in from the Windows desktop connected directly to this Sigma host. Web, mobile, and
          remote environments can use an existing host login but cannot start OAuth.
        </p>
      ) : null}

      {operationId === null ? (
        <div className="flex flex-wrap gap-2">
          {canUseBrowser ? (
            <Button
              type="button"
              size="sm"
              disabled={!props.canStartLogin || starting}
              onClick={() => void start("browser")}
            >
              {starting ? <LoaderIcon className="animate-spin" /> : <LogInIcon />}
              Login with ChatGPT
            </Button>
          ) : null}
          {canUseDeviceCode ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!props.canStartLogin || starting}
              onClick={() => void start("device-code")}
            >
              Use device code
            </Button>
          ) : null}
        </div>
      ) : null}

      {displayEvent?.type === "progress" ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <LoaderIcon className="size-4 animate-spin" />
          <span>{displayEvent.message}</span>
        </div>
      ) : null}

      {displayEvent?.type === "device_code" ? (
        <div className="space-y-2 rounded-lg border border-border/70 bg-muted/35 p-3">
          <p className="text-xs text-muted-foreground">Enter this one-time code in ChatGPT:</p>
          <div className="flex items-center gap-2">
            <code className="rounded bg-background px-2 py-1 text-sm font-semibold tracking-wider">
              {displayEvent.userCode}
            </code>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Copy device code"
              onClick={() => void navigator.clipboard.writeText(displayEvent.userCode)}
            >
              <CopyIcon />
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => void openExternal(displayEvent.verificationUri)}
            >
              <ExternalLinkIcon />
              Open ChatGPT
            </Button>
          </div>
        </div>
      ) : null}

      {displayEvent?.type === "input_required" ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void respond();
          }}
        >
          <label className="block space-y-1.5">
            <span className="text-sm text-foreground">{displayEvent.message}</span>
            {displayEvent.inputType === "select" && displayEvent.options ? (
              <select
                className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
              >
                <option value="">Choose an option</option>
                {displayEvent.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                autoFocus
                autoComplete="off"
                type={displayEvent.inputType === "secret" ? "password" : "text"}
                placeholder={displayEvent.placeholder ?? "Authorization code"}
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
              />
            )}
          </label>
          <Button type="submit" size="sm" disabled={responding || inputValue.trim().length === 0}>
            {responding ? <LoaderIcon className="animate-spin" /> : null}
            Continue
          </Button>
        </form>
      ) : null}

      {displayEvent?.type === "completed" ? (
        <div className="flex items-center gap-2 text-sm text-success" aria-live="polite">
          <CheckCircle2Icon className="size-4" />
          <span>ChatGPT subscription connected.</span>
        </div>
      ) : null}

      {error ? (
        <p className="text-sm leading-relaxed text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {props.onCancel && displayEvent?.type !== "completed" ? (
        <Button type="button" size="sm" variant="outline" onClick={() => void cancel()}>
          Cancel
        </Button>
      ) : null}
    </div>
  );
}

export function ProviderAuthConnectionControls(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly connection: ServerProviderAuthConnection;
  readonly canStartLogin: boolean;
}) {
  const logoutAuth = useAtomCommand(serverEnvironment.logoutProviderAuth, {
    reportFailure: false,
  });
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const authenticated = props.connection.status === "authenticated";

  const logout = useCallback(async () => {
    setLoggingOut(true);
    setError(null);
    const result = await logoutAuth({
      environmentId: props.environmentId,
      input: {
        instanceId: props.instanceId,
        connectionId: props.connection.id,
      },
    });
    setLoggingOut(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      setError(errorMessage(squashAtomCommandFailure(result)));
      return;
    }
    await refreshProviders({
      environmentId: props.environmentId,
      input: { instanceId: props.instanceId },
    });
  }, [logoutAuth, props.connection.id, props.environmentId, props.instanceId, refreshProviders]);

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-muted/25 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground">{props.connection.label}</p>
            {props.connection.experimental ? (
              <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                Experimental
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {authenticated
              ? "Connected through your ChatGPT/Codex subscription. API key billing is not used."
              : props.connection.status === "unknown"
                ? "Authentication status is unavailable. Refresh or sign in to continue."
                : "Login once to run Sigma models with your ChatGPT/Codex subscription."}
          </p>
          {authenticated && props.connection.email ? (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>Account</span>
              <RedactedSensitiveText
                value={props.connection.email}
                ariaLabel="Toggle ChatGPT account email visibility"
                revealTooltip="Click to reveal email"
                hideTooltip="Click to hide email"
              />
            </div>
          ) : null}
        </div>
        {authenticated ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loggingOut}
            onClick={() => void logout()}
          >
            {loggingOut ? <LoaderIcon className="animate-spin" /> : <LogOutIcon />}
            Logout
          </Button>
        ) : null}
      </div>

      {!authenticated ? (
        <ProviderAuthLoginFlow
          environmentId={props.environmentId}
          instanceId={props.instanceId}
          connection={props.connection}
          canStartLogin={props.canStartLogin}
          onCompleted={() => undefined}
        />
      ) : null}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ProviderAuthGateDialog(props: {
  readonly requirement: ProviderModelAuthRequirement;
  readonly environmentId: EnvironmentId;
  readonly canStartLogin: boolean;
  readonly onAuthenticated: () => void;
  readonly onCancel: () => void;
}) {
  const connection = props.requirement.connection;
  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogPopup className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Login to ChatGPT</DialogTitle>
          <DialogDescription>
            {props.requirement.model.name} uses your ChatGPT/Codex subscription. No OpenAI API key
            or API-key billing is required.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel scrollFade={false}>
          {connection ? (
            <ProviderAuthLoginFlow
              environmentId={props.environmentId}
              instanceId={props.requirement.provider.instanceId}
              connection={connection}
              canStartLogin={props.canStartLogin}
              autoStart
              onCompleted={props.onAuthenticated}
              onCancel={props.onCancel}
            />
          ) : (
            <p className="text-sm leading-relaxed text-destructive">
              This Sigma runtime advertises an authenticated model without its authentication
              connection. Update the bundled Sigma runtime and refresh providers.
            </p>
          )}
        </DialogPanel>
        {!connection ? (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onCancel}>
              Close
            </Button>
          </DialogFooter>
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}
