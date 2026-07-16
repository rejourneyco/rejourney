import { useEffect, useMemo, useState } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Rejourney } from '@rejourneyco/browser';
import { useDispatch, useSelector } from 'react-redux';
import {
  cartCleared,
  categoryChanged,
  checkoutReset,
  customerChanged,
  placeOrder,
  productAdded,
  products,
  promoApplied,
  quantityChanged,
  searchChanged,
  selectCartLines,
  selectCartTotals,
  type AppDispatch,
  type RootState,
} from './store';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function Shell() {
  const location = useLocation();
  const itemCount = useSelector((state: RootState) => selectCartTotals(state).itemCount);

  useEffect(() => {
    Rejourney.trackScreen(location.pathname, { title: document.title });
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <aside>
        <div className="brand"><span>N</span><div>NORTHSTAR<small>SUPPLY CO.</small></div></div>
        <nav>
          <NavLink to="/">Overview</NavLink>
          <NavLink to="/products">Products</NavLink>
          <NavLink to="/cart">Cart <b>{itemCount}</b></NavLink>
          <NavLink to="/orders">Orders</NavLink>
        </nav>
        <div className="sdk-status"><i /> REJOURNEY LIVE<small id="session-status">Redux capture enabled</small></div>
      </aside>
      <main>
        <header><p>COMMERCE OPERATIONS / <strong>{location.pathname === '/' ? 'OVERVIEW' : location.pathname.slice(1).toUpperCase()}</strong></p><div className="avatar">DS</div></header>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/products" element={<Products />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/orders" element={<Orders />} />
        </Routes>
      </main>
    </div>
  );
}

function Overview() {
  const totals = useSelector(selectCartTotals);
  const orders = useSelector((state: RootState) => state.checkout.orders);
  return <section className="page">
    <div className="eyebrow">THURSDAY, JULY 16</div>
    <h1>Good morning, Demo Shopper.</h1>
    <p className="lede">Your storefront is healthy. Here is what needs your attention today.</p>
    <div className="metric-grid">
      <article><span>ACTIVE CART</span><strong>{totals.itemCount}</strong><small>{money.format(totals.total)} in merchandise</small></article>
      <article><span>CATALOG</span><strong>{products.length}</strong><small>3 product collections</small></article>
      <article><span>ORDERS</span><strong>{orders.length}</strong><small>Latest order {orders[0]?.id}</small></article>
    </div>
    <div className="panel split"><div><span className="tag">REPLAY TEST PLAN</span><h2>Build a realistic journey</h2><p>Browse products, change quantities, apply a promotion, trigger a failed checkout, recover, and inspect each Redux transition beside the replay.</p></div><NavLink className="primary" to="/products">START SHOPPING →</NavLink></div>
  </section>;
}

function Products() {
  const dispatch = useDispatch<AppDispatch>();
  const { category, search } = useSelector((state: RootState) => state.catalog);
  const visible = useMemo(() => products.filter((product) => (category === 'All' || product.category === category) && product.name.toLowerCase().includes(search.toLowerCase())), [category, search]);
  return <section className="page">
    <div className="eyebrow">CURATED ESSENTIALS</div><h1>Tools for work and elsewhere.</h1><p className="lede">Considered objects, designed to earn their place.</p>
    <div className="filters">
      <input aria-label="Search products" value={search} onChange={(event) => dispatch(searchChanged(event.target.value))} placeholder="Search the collection" />
      {(['All', 'Desk', 'Travel', 'Audio'] as const).map((value) => <button className={category === value ? 'selected' : ''} onClick={() => dispatch(categoryChanged(value))} key={value}>{value}</button>)}
    </div>
    <div className="product-grid">{visible.map((product) => <article className="product" key={product.id}>
      <div className="product-art" style={{ background: product.color }}><span>{product.name.slice(0, 1)}</span></div>
      <div className="product-copy"><small>{product.category} · {product.stock} IN STOCK</small><h2>{product.name}</h2><p>{product.description}</p><div><strong>{money.format(product.price)}</strong><button aria-label={`Add ${product.name} to cart`} onClick={() => dispatch(productAdded(product.id))}>ADD +</button></div></div>
    </article>)}</div>
  </section>;
}

function Cart() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const lines = useSelector(selectCartLines);
  const totals = useSelector(selectCartTotals);
  const checkout = useSelector((state: RootState) => state.checkout);
  const [promo, setPromo] = useState('NORTH20');

  const submit = async (simulateFailure: boolean) => {
    const result = await dispatch(placeOrder({ total: totals.total, itemCount: totals.itemCount, simulateFailure }));
    if (placeOrder.fulfilled.match(result)) {
      dispatch(cartCleared());
      setTimeout(() => navigate('/orders'), 450);
    }
  };

  return <section className="page">
    <div className="eyebrow">CHECKOUT WORKSPACE</div><h1>Your field kit.</h1><p className="lede">Review the order, then test failure and recovery paths.</p>
    {lines.length === 0 ? <div className="empty"><h2>Your cart is empty.</h2><NavLink className="primary" to="/products">BROWSE PRODUCTS</NavLink></div> : <div className="checkout-grid">
      <div className="panel">
        {lines.map(({ product, quantity }) => <div className="cart-line" key={product.id}><div className="swatch" style={{ background: product.color }}>{product.name[0]}</div><div><strong>{product.name}</strong><small>{money.format(product.price)} each</small></div><div className="stepper"><button onClick={() => dispatch(quantityChanged({ id: product.id, quantity: quantity - 1 }))}>−</button><span>{quantity}</span><button onClick={() => dispatch(quantityChanged({ id: product.id, quantity: quantity + 1 }))}>+</button></div><b>{money.format(product.price * quantity)}</b></div>)}
        <div className="promo"><input aria-label="Promo code" value={promo} onChange={(event) => setPromo(event.target.value)} /><button onClick={() => dispatch(promoApplied(promo))}>APPLY CODE</button></div>
      </div>
      <div className="panel summary"><h2>Delivery details</h2><label>Name<input value={checkout.customer.name} onChange={(event) => dispatch(customerChanged({ name: event.target.value }))} /></label><label>Email<input value={checkout.customer.email} onChange={(event) => dispatch(customerChanged({ email: event.target.value }))} /></label><label>City<input value={checkout.customer.city} onChange={(event) => dispatch(customerChanged({ city: event.target.value }))} /></label><hr/><p>Subtotal <b>{money.format(totals.subtotal)}</b></p><p>Discount <b>−{money.format(totals.discount)}</b></p><p className="total">Total <b>{money.format(totals.total)}</b></p>
        {checkout.status === 'failed' ? <div className="error-banner"><strong>Reservation failed</strong><span>{checkout.error}</span><button onClick={() => dispatch(checkoutReset())}>DISMISS</button></div> : null}
        <button id="simulate-failure" className="secondary" disabled={checkout.status === 'submitting'} onClick={() => submit(true)}>SIMULATE FAILED ORDER</button>
        <button id="place-order" className="primary wide" disabled={checkout.status === 'submitting'} onClick={() => submit(false)}>{checkout.status === 'submitting' ? 'RESERVING INVENTORY…' : 'PLACE ORDER →'}</button>
      </div>
    </div>}
  </section>;
}

function Orders() {
  const orders = useSelector((state: RootState) => state.checkout.orders);
  return <section className="page"><div className="eyebrow">ORDER HISTORY</div><h1>Every shipment, in one place.</h1><p className="lede">The newest recovered checkout appears first.</p><div className="panel order-list">{orders.map((order) => <article key={order.id}><div><small>ORDER</small><strong>{order.id}</strong></div><div><small>PLACED</small><span>{new Date(order.createdAt).toLocaleString()}</span></div><div><small>ITEMS</small><span>{order.itemCount}</span></div><div><small>TOTAL</small><span>{money.format(order.total)}</span></div><b className={order.status === 'Delivered' ? 'done' : ''}>{order.status}</b></article>)}</div><NavLink className="secondary inline" to="/products">CONTINUE SHOPPING</NavLink></section>;
}

export default Shell;
