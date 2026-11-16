-- A contractor cost with nobody's name on it is an unattributable payment.
--
-- The Invoicing panel offers Contractor, Contractor cost and Cost currency together as
-- soon as the Expert is Contractor, and nothing stopped someone typing the cost and
-- leaving the name on "— choose —". That is money going out to an unnamed party: the
-- invoice report counts it (099 defines contractor work as expert = 'Contractor' OR a
-- non-zero outsource_price, precisely because the name catches almost nothing), but no
-- page can say who was paid, and no one can reconcile it against a contractor's own bill.
--
-- WHY A TRIGGER AND NOT A CHECK IN EACH RPC. Exactly three functions write
-- outsource_price — confirm_opportunity, update_project_fields and
-- update_sheet_row_fields, each with two overloads — and all of them funnel into these
-- two tables. One trigger per table is the whole surface, and it holds for anything added
-- later too, including a direct insert from a script.
--
-- WHY IT CHECKS THE CHANGE AND NOT THE ROW. 302 of the old sheet's lines already carry a
-- contractor cost with no name, and 4 dashboard rows do. Refusing any save on those would
-- mean a 2025 line could never have its invoice number typed in — friction with no defect
-- behind it, the same trap the start-date gate was deliberately kept out of (see the note
-- in EditLedgerRowDialog). So the rule only bites when THIS write is what puts an
-- unattributed cost there: the cost changed, or a name that was there has been cleared.
-- History is left alone; it is simply never added to.

create or replace function public.contractor_cost_needs_a_name()
returns trigger language plpgsql as $function$
declare
  v_prev numeric;   -- the cost this row already stood at, before this write
begin
  if coalesce(btrim(new.expert), '') <> 'Contractor' then return new; end if;
  if coalesce(new.outsource_price, 0) = 0 then return new; end if;
  if coalesce(btrim(new.contractor_name), '') <> '' then return new; end if;

  -- A sheet line's cost may live in the spreadsheet rather than in the overlay being
  -- written here, so the overlay's own old value is not the whole of "before".
  if tg_table_name = 'sheet_row_overrides' then
    select coalesce(case when tg_op = 'UPDATE' then old.outsource_price end, s.outsource_price)
      into v_prev
      from public.web_sheet_rows_src s where s.row_index = new.row_index;
  elsif tg_op = 'UPDATE' then
    v_prev := old.outsource_price;
  end if;

  -- Untouched cost, untouched blank name: this write is not what broke it.
  if new.outsource_price is not distinct from v_prev
     and not (tg_op = 'UPDATE' and coalesce(btrim(old.contractor_name), '') <> '') then
    return new;
  end if;

  raise exception 'Choose the contractor before saving a cost of %. A contractor cost with no name on it cannot be reconciled against anybody''s invoice.',
    to_char(new.outsource_price, 'FM999,999,999.00')
    using errcode = '23502';
end $function$;

create or replace trigger contractor_cost_needs_a_name
  before insert or update on public.opportunities
  for each row execute function public.contractor_cost_needs_a_name();

create or replace trigger contractor_cost_needs_a_name
  before insert or update on public.sheet_row_overrides
  for each row execute function public.contractor_cost_needs_a_name();
