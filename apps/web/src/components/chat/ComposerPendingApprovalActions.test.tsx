import { ApprovalRequestId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";

describe("ComposerPendingApprovalActions", () => {
  it("renders only the actions offered by a provider permission request", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalActions
        requestId={ApprovalRequestId.make("approval-1")}
        isResponding={false}
        actions={[
          { decision: "accept", label: "Keep current changes" },
          { decision: "decline", label: "Restore pre-interruption state" },
        ]}
        onRespondToApproval={vi.fn()}
      />,
    );

    expect(markup).toContain("Keep current changes");
    expect(markup).toContain("Restore pre-interruption state");
    expect(markup).toContain("Cancel turn");
    expect(markup).not.toContain("Always allow this session");
    expect(markup).not.toContain("Approve once");
  });
});
