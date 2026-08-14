import { commercial } from "@fleeter/core";
import { apiQuery } from "../../../../lib/api/handler";

/** `GET /v1/contract-versions/{id}` — términos, tarifas y revisión como ETag. */
export const GET = (request: Request, ctx: { params: Promise<{ versionId: string }> }) =>
  apiQuery(
    request,
    {
      command: "GetContractVersion",
      entityType: "ContractVersion",
      etag: (result: { revision: number }) => result.revision,
    },
    async (tx, { session }) =>
      commercial.getContractVersion(tx, session.actor, (await ctx.params).versionId),
  );
