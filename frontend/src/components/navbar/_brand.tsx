import { Center, Group, Image, Text, UnstyledButton } from '@mantine/core';

import PreloadLink from '@components/utils/link';

export function Brand() {
  return (
    <Center mr="0.75rem" style={{ minWidth: 'fit-content' }}>
      <UnstyledButton component={PreloadLink} href="/">
        <Group gap="xs" wrap="nowrap">
          <Image
            style={{ width: '164px', maxWidth: '42vw', marginRight: '0px' }}
            src="/swu-banner.png"
            alt="Star Wars Unlimited banner"
          />
          <Text fw={700} size="sm" style={{ whiteSpace: 'nowrap' }}>
            The Youngling Training Program Sealed League
          </Text>
        </Group>
      </UnstyledButton>
    </Center>
  );
}

export function BrandFooter() {
  return (
    <Center mr="1rem">
      <Center>
        <Image
          mb="0.25rem"
          style={{ width: '180px', marginRight: '0px' }}
          src="/swu-banner.png"
          alt="Star Wars Unlimited banner"
        />
      </Center>
    </Center>
  );
}
