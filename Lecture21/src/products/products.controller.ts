import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseIntPipe,
  Query,
  ParseBoolPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Public, Roles } from '../auth/decorators';
import { UserRole } from '../entities/user.entity';
import { THROTTLE_ADMIN_WRITE } from '../config/throttle.config';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @Throttle(THROTTLE_ADMIN_WRITE)
  @Roles(UserRole.ADMIN)
  create(@Body() createProductDto: CreateProductDto) {
    return this.productsService.create(createProductDto);
  }

  @Public()
  @Get('search')
  async search(
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('isAvailable') isAvailable?: string,
    @Query('sortBy') sortBy?: 'name' | 'price' | 'createdAt',
    @Query('sortOrder') sortOrder?: 'ASC' | 'DESC',
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('explain', new ParseBoolPipe({ optional: true })) explain?: boolean,
  ) {
    const searchProductsQuery = {
      search,
      category,
      minPrice: minPrice ? parseFloat(minPrice) : undefined,
      maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
      isAvailable: isAvailable ? isAvailable === 'true' : undefined,
      sortBy,
      sortOrder,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    };

    const result = await this.productsService.search(searchProductsQuery);

    if (explain) {
      const explainResult =
        await this.productsService.explainSearch(searchProductsQuery);
      return { ...result, explain: explainResult };
    }

    return result;
  }

  @Public()
  @Get()
  findAll(@Query('category') category?: string) {
    if (category) {
      return this.productsService.findByCategory(category);
    }
    return this.productsService.findAll();
  }

  @Public()
  @Get('available')
  findAvailable() {
    return this.productsService.findAvailable();
  }

  @Public()
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) productRecordId: number) {
    return this.productsService.findOne(productRecordId);
  }

  @Patch(':id')
  @Throttle(THROTTLE_ADMIN_WRITE)
  @Roles(UserRole.ADMIN)
  update(
    @Param('id', ParseIntPipe) productRecordId: number,
    @Body() updateProductDto: UpdateProductDto,
  ) {
    return this.productsService.update(productRecordId, updateProductDto);
  }

  @Delete(':id')
  @Throttle(THROTTLE_ADMIN_WRITE)
  @Roles(UserRole.ADMIN)
  remove(@Param('id', ParseIntPipe) productRecordId: number) {
    return this.productsService.remove(productRecordId);
  }
}
