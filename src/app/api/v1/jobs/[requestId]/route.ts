import { requireApiCredentials, requireApiIdentity } from "@/auth/api-auth";

import { apiError, jsonOk, originOf } from "../../_lib/http";
import { jobNeedsPoll, jobResponse, refreshJob, requireJob } from "../../_lib/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Segment = { params: Promise<{ requestId: string }> };

export async function GET(request: Request, segment: Segment): Promise<Response> {
  try {
    const identity = await requireApiIdentity(request, "read");
    const { requestId } = await segment.params;
    const job = await requireJob(identity.userId, requestId);
    if (!jobNeedsPoll(job)) return jsonOk(jobResponse(request, job));

    const credentials = await requireApiCredentials(identity);
    const fresh = await refreshJob(
      { userId: identity.userId, credentials, origin: originOf(request) },
      job,
    );
    return jsonOk(jobResponse(request, fresh));
  } catch (caught) {
    return apiError(caught);
  }
}
