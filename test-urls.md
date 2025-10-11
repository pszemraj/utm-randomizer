# Test URLs for UTM Randomizer

Test these URLs by copying them to your clipboard:

## Basic UTM URLs
```
https://example.com?utm_source=facebook&utm_medium=social&utm_campaign=spring_sale
https://google.com?utm_source=newsletter&utm_medium=email&utm_campaign=weekly_digest&utm_term=keyword&utm_content=cta_button
```

## Real-world examples
```
https://amazon.com/product?utm_source=google&utm_medium=cpc&utm_campaign=product_ads&utm_term=laptop&utm_content=ad_headline
https://github.com/repo?utm_source=twitter&utm_medium=social&utm_campaign=open_source&utm_content=tweet_link
```

## Mixed parameters (should only randomize UTM ones)
```
https://store.com/item?id=123&utm_source=affiliate&utm_medium=referral&color=blue&utm_campaign=holiday_sale
```

## No UTM parameters (should remain unchanged)
```
https://example.com/page?id=123&category=tech&sort=date
```

## Modern analytics IDs (should jumble tokens too)
```
https://news.site/story?fbclid=IwAR1abc123XYZ&gclid=CjwK12345&msclkid=abcdef012345&utm_source=newsletter&utm_medium=email
https://shop.example/product?mkt_tok=MTIzLTM0NTYtNzg5MC1hYmNkLWVmZ2hp&utm_campaign=sale&utm_content=hero_banner
https://blog.b2b.com/post?_hsenc=p123456789&_hsmi=12345678&mc_cid=abc123&mc_eid=4df567&utm_term=marketing
```
