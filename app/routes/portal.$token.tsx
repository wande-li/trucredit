import type { LoaderFunctionArgs, LinksFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Outlet, useLoaderData, useLocation, NavLink } from "@remix-run/react";
import { validatePortalSession, getShopInfo } from "~/services/portal.server";
import { tryExtractTokenPayload, extendPortalToken } from "~/services/token.server";
import portalStyles from "~/styles/portal.css?url";
import PortalErrorBoundary from "~/components/PortalErrorBoundary";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: portalStyles },
];

export interface PortalOutletContext {
  token: string;
  shopDomain: string;
  shopCurrency: string;
}

const NAV = [
  { to: "", label: "Dashboard", exact: true },
  { to: "invoices", label: "Invoices" },
  { to: "history", label: "Payments" },
  { to: "statements", label: "Statement" },
  { to: "application", label: "Credit" },
] as const;

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const token = params.token;
  if (!token) throw new Response("Token required", { status: 400 });
  const session = await validatePortalSession(token);
  if (!session) {
    // Token expired or invalid — attempt to extract shop context for renewal page
    const payload = await tryExtractTokenPayload(token);
    if (payload && payload.scope === "portal") {
      const shop = await getShopInfo(payload.shopId);
      if (shop?.shopDomain) {
        throw redirect(`/portal/renew?shop=${encodeURIComponent(shop.shopDomain)}`);
      }
    }
    throw new Response("Invalid or expired link", { status: 401 });
  }

  // P2: Sliding expiration — extend token TTL on each visit
  extendPortalToken(token).catch(() => {});

  const shop = await getShopInfo(session.shopId);
  return { token, shopDomain: shop?.shopDomain ?? "Shopify", shopCurrency: shop?.currency ?? "USD" };
};

export default function PortalLayout() {
  const { token, shopDomain, shopCurrency } = useLoaderData<typeof loader>();
  const location = useLocation();
  const base = `/portal/${token}`;
  const currentPage = location.pathname.replace(base, "").replace(/^\//, "");

  return (
    <div className="portal-page-body">
      {/* Header with brand logo */}
      <header className="portal-page-header">
        <div className="portal-header-brand">
          <div className="portal-header-logo" aria-hidden="true">TC</div>
          <div>
            <span className="portal-header-title">Payment Portal</span>
            <span className="portal-header-shop">{shopDomain}</span>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="portal-page-nav" role="navigation" aria-label="Customer Portal">
        {NAV.map((n) => {
          const isActive = n.exact ? currentPage === "" : currentPage === n.to || (n.to && currentPage.startsWith(n.to));
          return (
            <NavLink
              key={n.to}
              to={`${base}${n.to ? `/${n.to}` : ""}`}
              className={isActive ? "portal-nav-link--active" : "portal-nav-link"}
              aria-current={isActive ? "page" : undefined}
              end={n.exact}
            >
              {n.label}
            </NavLink>
          );
        })}
      </nav>

      {/* Content */}
      <main className="portal-page-main">
        <Outlet context={{ token, shopDomain, shopCurrency } satisfies PortalOutletContext} />
      </main>
    </div>
  );
}

export { PortalErrorBoundary as ErrorBoundary };
