// 1. Remove the imports required by the existing searchResultsTransformer
import { getFormatter, getTranslations } from 'next-intl/server';
 
import { SearchResult } from '@/vibes/soul/primitives/navigation';
 
import { pricesTransformer } from './prices-transformer';

// 2. Define the AlgoliaHit type returned by the Algolia API via the algoliaClient
export interface AlgoliaHit {
  objectID: string;
  name: string;
  url: string;
  product_images: Array<{
    description: string;
    is_thumbnail: boolean;
    url_thumbnail: string;
  }>;
  categories_without_path: string[];
  default_price: string;
  prices: Record<string, number>;
  sales_prices: Record<string, number>;
  calculated_prices: Record<string, number>;
  retail_prices: Record<string, number>;
}

// 3. Implement the algoliaResultsTransformer function
export async function algoliaResultsTransformer(
  hits: AlgoliaHit[]
): Promise<SearchResult[]> {
  // 4. Get the formatter and translations for the current locale
  const format = await getFormatter();
  const t = await getTranslations('Components.Header.Search');
 
  // 5. Transform the Algolia hits into SearchResult objects
  const products = hits.map((hit) => {
    const price = pricesTransformer(
      {
        price: {
          value: hit.calculated_prices.USD ?? 0,
          currencyCode: 'USD',
        },
        basePrice: {
          value: parseInt(hit.default_price, 10),
          currencyCode: 'USD',
        },
        retailPrice: {
          value: hit.retail_prices.USD ?? 0,
          currencyCode: 'USD',
        },
        salePrice: {
          value:
            hit.sales_prices.USD && hit.sales_prices.USD > 0
              ? hit.sales_prices.USD
              : parseInt(hit.default_price, 10),
          currencyCode: 'USD',
        },
        priceRange: {
          min: {
            value: hit.prices.USD ?? 0,
            currencyCode: 'USD',
          },
          max: {
            value: hit.prices.USD ?? 0,
            currencyCode: 'USD',
          },
        },
      },
      format
    );
 
    return {
      id: hit.objectID,
      title: hit.name,
      href: hit.url,
      price,
      image: {
        src:
          hit.product_images.find((image) => image.is_thumbnail)
            ?.url_thumbnail ?? '',
        alt: hit.product_images[0]?.description ?? '',
      },
    };
  });

  // 6. Create the product results SearchResult object
  const productResults: SearchResult = {
    type: 'products',
    title: t('products'),
    products,
  };
 
  // 7. For the returned product results, create a unique list of categories.
  //    For example, if you had two products, one with categories ['Electronics',
  //    'Computers'] and another with ['Electronics', 'Cameras'], this step would
  //    produce ['Electronics', 'Computers', 'Cameras'].
  const uniqueCategories = Array.from(
    new Set(hits.flatMap((product) => product.categories_without_path))
  );
 
  // 8. Create the category results SearchResult object
  const categoryResults: SearchResult = {
    type: 'links',
    title: t('categories'),
    links: uniqueCategories.map((category) => {
      return {
        label: category,
        href: `/${category.toLowerCase().replace(/\s+/g, '-')}`,
      };
    }),
  };
 
  // 9. Create an array to hold the final results
  const results = [];
 
  // 10. If there are any categories, add them to the results
  if (categoryResults.links.length > 0) {
    results.push(categoryResults);
  }
 
  // 11. If there are any products, add them to the results
  if (products.length > 0) {
    results.push(productResults);
  }
 
  return results;
}
