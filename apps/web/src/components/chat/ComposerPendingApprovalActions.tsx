import { type ApprovalRequestId, type ProviderApprovalDecision } from "@t3tools/contracts";
import { memo } from "react";
import { Button } from "../ui/button";

interface ComposerPendingApprovalActionsProps {
  requestId: ApprovalRequestId;
  isResponding: boolean;
  actions?: ReadonlyArray<{
    decision: Exclude<ProviderApprovalDecision, "cancel">;
    label: string;
  }>;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
}

export const ComposerPendingApprovalActions = memo(function ComposerPendingApprovalActions({
  requestId,
  isResponding,
  actions,
  onRespondToApproval,
}: ComposerPendingApprovalActionsProps) {
  const displayedActions = actions ?? [
    { decision: "decline" as const, label: "Decline" },
    { decision: "acceptForSession" as const, label: "Always allow this session" },
    { decision: "accept" as const, label: "Approve once" },
  ];
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={isResponding}
        onClick={() => void onRespondToApproval(requestId, "cancel")}
      >
        Cancel turn
      </Button>
      {displayedActions.map((action) => (
        <Button
          key={action.decision}
          size="sm"
          variant={
            action.decision === "decline"
              ? "destructive-outline"
              : action.decision === "acceptForSession"
                ? "outline"
                : "default"
          }
          disabled={isResponding}
          onClick={() => void onRespondToApproval(requestId, action.decision)}
        >
          {action.label}
        </Button>
      ))}
    </>
  );
});
