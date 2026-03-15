import * as DataLoader from 'dataloader';
import { Injectable, Scope } from '@nestjs/common';
import { ProductsService } from '../../products/products.service';
import { Product } from '../../entities/product.entity';

@Injectable({ scope: Scope.REQUEST })
export class ProductLoader {
  private readonly loader: DataLoader<number, Product | null>;

  constructor(private readonly productsService: ProductsService) {
    this.loader = new DataLoader<number, Product | null>(
      async (productIds: readonly number[]) => {
        const products = await this.productsService.findByIds([...productIds]);

        const productMap = new Map<number, Product>();
        for (const product of products) {
          productMap.set(product.id, product);
        }

        return productIds.map((id) => productMap.get(id) ?? null);
      },
    );
  }

  load(productId: number): Promise<Product | null> {
    return this.loader.load(productId);
  }

  loadMany(productIds: number[]): Promise<(Product | Error | null)[]> {
    return this.loader.loadMany(productIds);
  }
}

