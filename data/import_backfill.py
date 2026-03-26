#!/usr/bin/env python3
"""
Import SB and SD backfill CSVs from Amazon native platform into Snowflake.
Only inserts rows that don't already exist (date + campaign_id + profile_id).
"""
import csv
import re
import os
import sys
import subprocess
import json
from datetime import datetime

CLIENT_ID  = '7d88ea17-002b-4a02-97fc-bcab1292d57e'
PROFILE_ID = '2115070599068216'  # CyberPower US ads profile

def parse_date(s):
    """'Mar 11, 2026' -> '2026-03-11'"""
    s = s.strip().strip('"')
    try:
        return datetime.strptime(s, '%b %d, %Y').strftime('%Y-%m-%d')
    except:
        return None

def clean_id(s):
    """'=""422752340317837""' -> '422752340317837'"""
    return re.sub(r'[="\s]', '', s)

def clean_float(s):
    s = str(s).strip().strip('"')
    if s in ('', 'None', 'null', '-'):
        return None
    try:
        return float(s)
    except:
        return None

def clean_int(s):
    v = clean_float(s)
    return int(v) if v is not None else None

def run_query(sql, params=None):
    """Run a Snowflake query via Node.js"""
    script = f"""
require('dotenv').config();
const {{query}} = require('./src/services/snowflakeService');
const sql = {json.dumps(sql)};
const params = {json.dumps(params or [])};
query(sql, params)
  .then(r => {{ console.log(JSON.stringify(r)); process.exit(0); }})
  .catch(e => {{ console.error('ERR:', e.message); process.exit(1); }});
"""
    result = subprocess.run(
        ['node', '-e', script],
        capture_output=True, text=True,
        cwd='/home/azureuser/.openclaw/workspace'
    )
    if result.returncode != 0:
        raise Exception(result.stderr[:200])
    return json.loads(result.stdout.strip()) if result.stdout.strip() else []

def import_sb(filepath):
    print(f"\n=== Importing SB from {filepath} ===")
    rows_to_insert = []
    
    with open(filepath, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            date = parse_date(row.get('Date',''))
            if not date:
                continue
            campaign_id = clean_id(row.get('Campaign ID',''))
            if not campaign_id:
                continue
            
            rows_to_insert.append({
                'client_id':   CLIENT_ID,
                'profile_id':  PROFILE_ID,
                'campaign_id': campaign_id,
                'report_date': date,
                'campaign_name': row.get('Campaign name','').strip('"'),
                'campaign_status': row.get('Campaign delivery status','').strip('"'),
                'campaign_budget_amount': clean_float(row.get('Campaign budget amount','')),
                'campaign_budget_type': row.get('Campaign budget type','').strip('"'),
                'campaign_budget_currency_code': row.get('Budget currency','').strip('"') or 'USD',
                'cost_type': 'CPC',
                'impressions': clean_int(row.get('Impressions','0')),
                'clicks': clean_int(row.get('Clicks','0')),
                'cost': clean_float(row.get('Total cost','0')),
                'purchases': clean_int(row.get('Purchases','0')),
                'purchases_clicks': clean_int(row.get('Purchases','0')),
                'sales': clean_float(row.get('Sales','0')),
                'sales_clicks': clean_float(row.get('Sales','0')),
                'units_sold': clean_int(row.get('Units sold','0')),
                'units_sold_clicks': clean_int(row.get('Units sold','0')),
                'new_to_brand_purchases': clean_int(row.get('Purchases (new to brand)','0')),
                'new_to_brand_purchases_clicks': clean_int(row.get('Purchases (new to brand)','0')),
                'new_to_brand_sales': clean_float(row.get('Sales (new to brand)','0')),
                'new_to_brand_sales_clicks': clean_float(row.get('Sales (new to brand)','0')),
                'new_to_brand_units_sold': clean_int(row.get('Units sold (new to brand)','0')),
                'new_to_brand_units_sold_clicks': clean_int(row.get('Units sold (new to brand)','0')),
                'detail_page_views': clean_int(row.get('Detail page views','0')),
                'detail_page_views_clicks': clean_int(row.get('Detail page views','0')),
                'add_to_cart': clean_int(row.get('Add to cart','0')),
                'add_to_cart_clicks': clean_int(row.get('Add to cart','0')),
                'branded_searches': None,
                'branded_searches_clicks': None,
                'brand_store_page_view': clean_int(row.get('Brand store page views','0')),
                'top_of_search_impression_share': None,
                'video_5_second_views': clean_int(row.get('5-second views (video ad)','0')),
                'video_complete_views': clean_int(row.get('Complete views (video ad)','0')),
                'viewability_rate': None,
                'viewable_impressions': clean_int(row.get('Viewable impressions','0')),
            })
    
    print(f"  Parsed {len(rows_to_insert)} rows")
    
    inserted = 0
    skipped = 0
    for r in rows_to_insert:
        sql = """
MERGE INTO sb_campaign_report t
USING (SELECT ? AS client_id, ? AS profile_id, ? AS campaign_id, ?::DATE AS report_date) s
ON t.client_id=s.client_id AND t.profile_id=s.profile_id AND t.campaign_id=s.campaign_id AND t.report_date=s.report_date
WHEN NOT MATCHED THEN INSERT (
  client_id, profile_id, campaign_id, report_date,
  campaign_name, campaign_status, campaign_budget_amount, campaign_budget_type, campaign_budget_currency_code, cost_type,
  impressions, clicks, cost, purchases, purchases_clicks, sales, sales_clicks, units_sold, units_sold_clicks,
  new_to_brand_purchases, new_to_brand_purchases_clicks, new_to_brand_sales, new_to_brand_sales_clicks,
  new_to_brand_units_sold, new_to_brand_units_sold_clicks,
  detail_page_views, detail_page_views_clicks, add_to_cart, add_to_cart_clicks,
  brand_store_page_view, video_5_second_views, video_complete_views, viewable_impressions, synced_at
) VALUES (?,?,?,?::DATE,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
"""
        params = [
            r['client_id'], r['profile_id'], r['campaign_id'], r['report_date'],
            # INSERT
            r['client_id'], r['profile_id'], r['campaign_id'], r['report_date'],
            r['campaign_name'], r['campaign_status'], r['campaign_budget_amount'],
            r['campaign_budget_type'], r['campaign_budget_currency_code'], r['cost_type'],
            r['impressions'], r['clicks'], r['cost'],
            r['purchases'], r['purchases_clicks'], r['sales'], r['sales_clicks'],
            r['units_sold'], r['units_sold_clicks'],
            r['new_to_brand_purchases'], r['new_to_brand_purchases_clicks'],
            r['new_to_brand_sales'], r['new_to_brand_sales_clicks'],
            r['new_to_brand_units_sold'], r['new_to_brand_units_sold_clicks'],
            r['detail_page_views'], r['detail_page_views_clicks'],
            r['add_to_cart'], r['add_to_cart_clicks'],
            r['brand_store_page_view'], r['video_5_second_views'],
            r['video_complete_views'], r['viewable_impressions'],
        ]
        try:
            result = run_query(sql, params)
            ins = result[0].get('number of rows inserted', 0) if result else 0
            if ins > 0:
                inserted += 1
            else:
                skipped += 1
        except Exception as e:
            print(f"  ERROR row {r['campaign_id']} {r['report_date']}: {e}")
            skipped += 1
    
    print(f"  Inserted: {inserted} | Skipped (already exists): {skipped}")
    return inserted

def import_sd(filepath):
    print(f"\n=== Importing SD from {filepath} ===")
    rows_to_insert = []
    
    with open(filepath, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            date = parse_date(row.get('Date',''))
            if not date:
                continue
            campaign_id = clean_id(row.get('Campaign ID',''))
            if not campaign_id:
                continue
            
            rows_to_insert.append({
                'client_id':   CLIENT_ID,
                'profile_id':  PROFILE_ID,
                'campaign_id': campaign_id,
                'date':        date,
                'campaign_name': row.get('Campaign name','').strip('"'),
                'campaign_status': row.get('Campaign delivery status','').strip('"'),
                'campaign_budget_amount': clean_float(row.get('Campaign budget amount','')),
                'campaign_budget_type': row.get('Campaign budget type','').strip('"'),
                'campaign_budget_currency_code': row.get('Budget currency','').strip('"') or 'USD',
                'cost_type': 'CPC',
                'impressions': clean_int(row.get('Impressions','0')),
                'clicks': clean_int(row.get('Clicks','0')),
                'cost': clean_float(row.get('Total cost','0')),
                'purchases': clean_int(row.get('Purchases','0')),
                'purchases_clicks': clean_int(row.get('Purchases','0')),
                'sales': clean_float(row.get('Sales','0')),
                'sales_clicks': clean_float(row.get('Sales','0')),
                'units_sold': clean_int(row.get('Units sold','0')),
                'units_sold_clicks': clean_int(row.get('Units sold','0')),
                'new_to_brand_purchases': clean_int(row.get('Purchases (new to brand)','0')),
                'new_to_brand_purchases_clicks': clean_int(row.get('Purchases (new to brand)','0')),
                'new_to_brand_sales': clean_float(row.get('Sales (new to brand)','0')),
                'new_to_brand_sales_clicks': clean_float(row.get('Sales (new to brand)','0')),
                'new_to_brand_units_sold': clean_int(row.get('Units sold (new to brand)','0')),
                'new_to_brand_units_sold_clicks': clean_int(row.get('Units sold (new to brand)','0')),
                'detail_page_views': clean_int(row.get('Detail page views','0')),
                'detail_page_views_clicks': clean_int(row.get('Detail page views','0')),
                'add_to_cart': clean_int(row.get('Add to cart','0')),
                'add_to_cart_clicks': clean_int(row.get('Add to cart','0')),
                'viewable_impressions': clean_int(row.get('Viewable impressions','0')),
            })
    
    print(f"  Parsed {len(rows_to_insert)} rows")
    
    inserted = 0
    skipped = 0
    for r in rows_to_insert:
        sql = """
MERGE INTO sd_campaign_report t
USING (SELECT ? AS client_id, ? AS profile_id, ? AS campaign_id, ?::DATE AS date) s
ON t.client_id=s.client_id AND t.profile_id=s.profile_id AND t.campaign_id=s.campaign_id AND t.date=s.date
WHEN NOT MATCHED THEN INSERT (
  client_id, profile_id, campaign_id, date,
  campaign_name, campaign_status, campaign_budget_amount, campaign_budget_type, campaign_budget_currency_code, cost_type,
  impressions, clicks, cost, purchases, purchases_clicks, sales, sales_clicks, units_sold, units_sold_clicks,
  new_to_brand_purchases, new_to_brand_purchases_clicks, new_to_brand_sales, new_to_brand_sales_clicks,
  new_to_brand_units_sold, new_to_brand_units_sold_clicks,
  detail_page_views, detail_page_views_clicks, add_to_cart, add_to_cart_clicks,
  viewable_impressions, synced_at
) VALUES (?,?,?,?::DATE,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
"""
        params = [
            r['client_id'], r['profile_id'], r['campaign_id'], r['date'],
            r['client_id'], r['profile_id'], r['campaign_id'], r['date'],
            r['campaign_name'], r['campaign_status'], r['campaign_budget_amount'],
            r['campaign_budget_type'], r['campaign_budget_currency_code'], r['cost_type'],
            r['impressions'], r['clicks'], r['cost'],
            r['purchases'], r['purchases_clicks'], r['sales'], r['sales_clicks'],
            r['units_sold'], r['units_sold_clicks'],
            r['new_to_brand_purchases'], r['new_to_brand_purchases_clicks'],
            r['new_to_brand_sales'], r['new_to_brand_sales_clicks'],
            r['new_to_brand_units_sold'], r['new_to_brand_units_sold_clicks'],
            r['detail_page_views'], r['detail_page_views_clicks'],
            r['add_to_cart'], r['add_to_cart_clicks'],
            r['viewable_impressions'],
        ]
        try:
            result = run_query(sql, params)
            ins = result[0].get('number of rows inserted', 0) if result else 0
            if ins > 0:
                inserted += 1
            else:
                skipped += 1
        except Exception as e:
            print(f"  ERROR row {r['campaign_id']} {r['date']}: {e}")
            skipped += 1
    
    print(f"  Inserted: {inserted} | Skipped (already exists): {skipped}")
    return inserted

if __name__ == '__main__':
    base = '/home/azureuser/.openclaw/workspace/data'
    sb_total = import_sb(f'{base}/sb_backfill.csv')
    sd_total = import_sd(f'{base}/sd_backfill.csv')
    print(f"\n=== DONE === SB: {sb_total} rows | SD: {sd_total} rows inserted")
