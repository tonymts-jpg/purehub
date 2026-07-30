import { accountRouteError, requireEmptyAccountMutation, requireEmptyAccountQuery } from "@/lib/account/http";
import { assertNoAccountIdentityOverrideHeaders, recordPostView } from "@/lib/account/repository";
import { enforceSameOrigin, requireUser } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  try {
    assertNoAccountIdentityOverrideHeaders(request);
  } catch (error) {
    return accountRouteError(error);
  }
  const session = await requireUser(request);
  if (!session.ok) return session.response;

  try {
    requireEmptyAccountQuery(request);
    await requireEmptyAccountMutation(request);
    await recordPostView(session.user.id, (await params).id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return accountRouteError(error);
  }
}
