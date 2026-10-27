# Route 53 Name Server Records for stevenclarke.dev

Hosted Zone ID: `Z00867441C0IRTKQ4C448`  
Domain: `stevenclarke.dev`  

## Route 53 Nameservers

Copy these nameservers to GoDaddy to delegate DNS:

```
ns-1370.awsdns-43.org
ns-142.awsdns-17.com
ns-530.awsdns-02.net
ns-1997.awsdns-57.co.uk
```

## How to configure in GoDaddy

1. Sign in to [GoDaddy](https://account.godaddy.com/).
2. Go to **My Products → Domains → stevenclarke.dev → Manage DNS** (or "DNS" / "Nameservers").
3. Under **Nameservers**, change from "GoDaddy Nameservers" to **"Custom"**.
4. Add all four nameservers from above (one per line/field).
5. Save changes.
6. DNS propagation can take anywhere from a few minutes to several hours. Verify with `dig` or `nslookup`.

## Verification

After updating nameservers, verify delegation:

```bash
dig NS stevenclarke.dev +short
```

Or:

```bash
nslookup -type=NS stevenclarke.dev
```

The results should match the Route 53 nameservers listed above.
