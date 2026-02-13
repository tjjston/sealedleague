import { Anchor, Container, Group } from '@mantine/core';

import { BrandFooter } from '@components/navbar/_brand';
import classes from './footer.module.css';

const links = [
  { link: '/docs', label: 'API Docs' },
  { link: '/api/docs', label: 'Swagger' },
];

export function DashboardFooter() {
  const items = links.map((link) => (
    <Anchor<'a'> c="dimmed" key={link.label} href={link.link} size="sm">
      {link.label}
    </Anchor>
  ));

  return (
    <div className={classes.footer}>
      <Container className={classes.inner}>
        <BrandFooter />
        <Group className={classes.links}>{items}</Group>
      </Container>
    </div>
  );
}
