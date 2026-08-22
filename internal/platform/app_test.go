package platform

import (
	"context"
	"testing"

	"whatsapp-agent-platform/internal/proxies"
)

type fakeAccountProxyPlanSource struct {
	plan proxies.Plan
}

func (f fakeAccountProxyPlanSource) ResolveProxyPlan(context.Context, string) (proxies.Plan, error) {
	return f.plan, nil
}

type fakeSystemProxyRouteSource struct {
	route systemProxyRoute
}

func (f fakeSystemProxyRouteSource) ResolveRoute(context.Context) (systemProxyRoute, error) {
	return f.route, nil
}

func TestSameProxyExitIPRecognizesClashAlreadyUsingAccountProxy(t *testing.T) {
	if !sameProxyExitIP("140.174.104.226", "140.174.104.226") {
		t.Fatal("expected matching exits to be recognized as the same route")
	}
}

func TestSameProxyExitIPRejectsDifferentOrUnknownExit(t *testing.T) {
	tests := []struct {
		name  string
		local string
		outer string
	}{
		{name: "different", local: "140.174.104.226", outer: "203.0.113.10"},
		{name: "missing local", local: "", outer: "140.174.104.226"},
		{name: "invalid local", local: "not-an-ip", outer: "140.174.104.226"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if sameProxyExitIP(test.local, test.outer) {
				t.Fatalf("did not expect %q and %q to be treated as the same exit", test.local, test.outer)
			}
		})
	}
}

func TestAccountProxyResolverDoesNotDuplicateClashRouteForSameExit(t *testing.T) {
	resolver := accountProxyResolver{
		local: fakeAccountProxyPlanSource{plan: proxies.Plan{
			ProxyURL:  "socks5://account-proxy:6688",
			RouteMode: proxies.RouteModeSystem,
			ExitIP:    "140.174.104.226",
		}},
		provider: fakeSystemProxyRouteSource{route: systemProxyRoute{
			ProxyURL: "http://127.0.0.1:7890",
			ExitIP:   "140.174.104.226",
		}},
	}

	plan, err := resolver.ResolveProxyPlan(context.Background(), "account-1")
	if err != nil {
		t.Fatalf("resolve proxy plan: %v", err)
	}
	if plan.ProxyURL != "http://127.0.0.1:7890" || plan.OuterProxyURL != "" || !plan.UsesSystem {
		t.Fatalf("expected existing Clash route without a duplicate inner proxy, got %+v", plan)
	}
}

func TestAccountProxyResolverChainsDifferentExitThroughClash(t *testing.T) {
	resolver := accountProxyResolver{
		local: fakeAccountProxyPlanSource{plan: proxies.Plan{
			ProxyURL:  "socks5://account-proxy:6688",
			RouteMode: proxies.RouteModeSystem,
			ExitIP:    "140.174.104.226",
		}},
		provider: fakeSystemProxyRouteSource{route: systemProxyRoute{
			ProxyURL: "http://127.0.0.1:7890",
			ExitIP:   "203.0.113.10",
		}},
	}

	plan, err := resolver.ResolveProxyPlan(context.Background(), "account-1")
	if err != nil {
		t.Fatalf("resolve proxy plan: %v", err)
	}
	if plan.ProxyURL != "socks5://account-proxy:6688" || plan.OuterProxyURL != "http://127.0.0.1:7890" || !plan.UsesSystem {
		t.Fatalf("expected a two-layer route through Clash, got %+v", plan)
	}
}
