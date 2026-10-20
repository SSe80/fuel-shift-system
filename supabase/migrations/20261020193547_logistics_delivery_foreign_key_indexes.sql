
create index if not exists logistics_deliveries_created_by_idx
  on public.logistics_deliveries (created_by);
create index if not exists logistics_deliveries_product_id_idx
  on public.logistics_deliveries (product_id);
create index if not exists logistics_deliveries_tank_id_idx
  on public.logistics_deliveries (tank_id);
create index if not exists logistics_delivery_compartments_truck_compartment_id_idx
  on public.logistics_delivery_compartments (truck_compartment_id);
create index if not exists purchases_shortage_payment_updated_by_idx
  on public.purchases (shortage_payment_updated_by);
