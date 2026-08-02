import { createRoute, Link } from '@tanstack/react-router';
import { accountLayoutRoute } from './_account.js';
import { EmptyState } from '../components/empty-state.js';
import { Button } from '../components/button.js';

function CartPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-semibold text-text">Cart</h1>
      <EmptyState
        title="Your cart is empty"
        description="Add equipment from the catalog to start a booking."
        action={
          <Link to="/equipment">
            <Button variant="primary">Browse equipments</Button>
          </Link>
        }
      />
    </div>
  );
}

export const accountCartRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/cart',
  component: CartPage,
});
