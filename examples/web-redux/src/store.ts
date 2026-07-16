import { configureStore, createAsyncThunk, createSelector, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { createRejourneyReduxMiddleware } from '@rejourneyco/browser/redux';

export interface Product {
  id: string;
  name: string;
  category: 'Desk' | 'Travel' | 'Audio';
  price: number;
  stock: number;
  color: string;
  description: string;
}

export const products: Product[] = [
  { id: 'lamp', name: 'Orbit Task Lamp', category: 'Desk', price: 129, stock: 8, color: '#fdba74', description: 'Warm, dimmable light with a weighted stone base.' },
  { id: 'stand', name: 'Arc Laptop Stand', category: 'Desk', price: 89, stock: 14, color: '#93c5fd', description: 'A folded aluminum stand built for all-day focus.' },
  { id: 'pack', name: 'Transit Daypack', category: 'Travel', price: 148, stock: 6, color: '#86efac', description: 'Weatherproof storage with a suspended device sleeve.' },
  { id: 'bottle', name: 'Field Flask', category: 'Travel', price: 42, stock: 19, color: '#fda4af', description: 'Vacuum insulated steel in a compact trail profile.' },
  { id: 'speaker', name: 'Mono Mini Speaker', category: 'Audio', price: 179, stock: 4, color: '#c4b5fd', description: 'Room-filling sound with one wonderfully simple dial.' },
  { id: 'phones', name: 'Studio Headphones', category: 'Audio', price: 219, stock: 11, color: '#fcd34d', description: 'Balanced wireless listening for work and wandering.' },
];

interface CatalogState { category: 'All' | Product['category']; search: string }
const catalogSlice = createSlice({
  name: 'catalog',
  initialState: { category: 'All', search: '' } as CatalogState,
  reducers: {
    categoryChanged: (state, action: PayloadAction<CatalogState['category']>) => { state.category = action.payload; },
    searchChanged: (state, action: PayloadAction<string>) => { state.search = action.payload; },
  },
});

interface CartState { items: Record<string, number>; promoCode: string | null; discountPercent: number }
const cartSlice = createSlice({
  name: 'cart',
  initialState: { items: {}, promoCode: null, discountPercent: 0 } as CartState,
  reducers: {
    productAdded: (state, action: PayloadAction<string>) => { state.items[action.payload] = (state.items[action.payload] || 0) + 1; },
    quantityChanged: (state, action: PayloadAction<{ id: string; quantity: number }>) => {
      if (action.payload.quantity <= 0) delete state.items[action.payload.id];
      else state.items[action.payload.id] = action.payload.quantity;
    },
    promoApplied: (state, action: PayloadAction<string>) => {
      state.promoCode = action.payload.toUpperCase();
      state.discountPercent = action.payload.toUpperCase() === 'NORTH20' ? 20 : 0;
    },
    cartCleared: (state) => { state.items = {}; state.promoCode = null; state.discountPercent = 0; },
  },
});

interface Order { id: string; createdAt: string; total: number; itemCount: number; status: 'Preparing' | 'Delivered' }
interface CheckoutState {
  customer: { name: string; email: string; city: string };
  paymentToken: string;
  status: 'idle' | 'submitting' | 'failed' | 'complete';
  error: string | null;
  orders: Order[];
}

export const placeOrder = createAsyncThunk(
  'checkout/placeOrder',
  async (payload: { total: number; itemCount: number; simulateFailure?: boolean }) => {
    await new Promise((resolve) => setTimeout(resolve, 650));
    if (payload.simulateFailure) throw new Error('Inventory reservation timed out');
    return {
      id: `NS-${Math.floor(10000 + Math.random() * 89999)}`,
      createdAt: new Date().toISOString(),
      total: payload.total,
      itemCount: payload.itemCount,
      status: 'Preparing' as const,
    };
  },
);

const checkoutSlice = createSlice({
  name: 'checkout',
  initialState: {
    customer: { name: 'Demo Shopper', email: 'shopper@redux-demo.invalid', city: 'Testville' },
    paymentToken: 'tok_demo_should_be_redacted',
    status: 'idle',
    error: null,
    orders: [
      { id: 'NS-10482', createdAt: '2026-07-11T10:30:00.000Z', total: 237, itemCount: 2, status: 'Delivered' },
    ],
  } as CheckoutState,
  reducers: {
    customerChanged: (state, action: PayloadAction<Partial<CheckoutState['customer']>>) => {
      state.customer = { ...state.customer, ...action.payload };
    },
    checkoutReset: (state) => { state.status = 'idle'; state.error = null; },
  },
  extraReducers: (builder) => {
    builder
      .addCase(placeOrder.pending, (state) => { state.status = 'submitting'; state.error = null; })
      .addCase(placeOrder.fulfilled, (state, action) => { state.status = 'complete'; state.orders.unshift(action.payload); })
      .addCase(placeOrder.rejected, (state, action) => { state.status = 'failed'; state.error = action.error.message || 'Order failed'; });
  },
});

export const { categoryChanged, searchChanged } = catalogSlice.actions;
export const { productAdded, quantityChanged, promoApplied, cartCleared } = cartSlice.actions;
export const { customerChanged, checkoutReset } = checkoutSlice.actions;

export const store = configureStore({
  reducer: {
    catalog: catalogSlice.reducer,
    cart: cartSlice.reducer,
    checkout: checkoutSlice.reducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(
    createRejourneyReduxMiddleware({
      redactKeys: ['email'],
      maxEventBytes: 96 * 1024,
      onError: (error) => console.error('[Redux capture error]', error),
    }),
  ),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const selectCartLines = createSelector(
  [(state: RootState) => state.cart.items],
  (items) => products
    .filter((product) => items[product.id])
    .map((product) => ({ product, quantity: items[product.id] || 0 })),
);

export const selectCartTotals = createSelector(
  [selectCartLines, (state: RootState) => state.cart.discountPercent],
  (lines, discountPercent) => {
    const subtotal = lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
    const discount = subtotal * (discountPercent / 100);
    return { subtotal, discount, total: subtotal - discount, itemCount: lines.reduce((sum, line) => sum + line.quantity, 0) };
  },
);
