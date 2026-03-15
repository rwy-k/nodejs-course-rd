import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../config/typeorm.config';
import { User, UserRole } from '../entities/user.entity';
import { Product } from '../entities/product.entity';
import * as bcrypt from 'bcrypt';

async function runSeed() {
  console.log('Starting seed...');

  const dataSource = new DataSource(dataSourceOptions);
  await dataSource.initialize();

  try {
    const userRepo = dataSource.getRepository(User);
    const productRepo = dataSource.getRepository(Product);

    const existingAdmin = await userRepo.findOne({
      where: { email: 'admin@example.com' },
    });

    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      const admin = userRepo.create({
        email: 'admin@example.com',
        password: hashedPassword,
        firstName: 'Admin',
        lastName: 'User',
        role: UserRole.ADMIN,
      });
      await userRepo.save(admin);
      console.log('Created admin user: admin@example.com');
    } else {
      console.log('Admin user already exists, skipping...');
    }

    const productCount = await productRepo.count();
    if (productCount === 0) {
      const products = [
        {
          name: 'Laptop Pro',
          description: 'High-performance laptop for professionals',
          price: 1299.99,
          stock: 10,
          category: 'Electronics',
          isAvailable: true,
        },
        {
          name: 'Wireless Mouse',
          description: 'Ergonomic wireless mouse with long battery life',
          price: 49.99,
          stock: 50,
          category: 'Electronics',
          isAvailable: true,
        },
        {
          name: 'USB-C Hub',
          description: '7-in-1 USB-C hub with HDMI and SD card reader',
          price: 79.99,
          stock: 25,
          category: 'Accessories',
          isAvailable: true,
        },
        {
          name: 'Mechanical Keyboard',
          description: 'RGB mechanical keyboard with Cherry MX switches',
          price: 149.99,
          stock: 15,
          category: 'Electronics',
          isAvailable: true,
        },
        {
          name: 'Monitor Stand',
          description: 'Adjustable monitor stand with cable management',
          price: 89.99,
          stock: 0,
          category: 'Accessories',
          isAvailable: false,
        },
      ];

      for (const productData of products) {
        const product = productRepo.create(productData);
        await productRepo.save(product);
        console.log(`Created product: ${product.name}`);
      }
    } else {
      console.log(`Products already exist (${productCount}), skipping...`);
    }

    console.log('Seed completed successfully!');
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  } finally {
    await dataSource.destroy();
  }
}

runSeed();
