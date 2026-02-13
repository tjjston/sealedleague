import { Center, Group, Image, Text, Title, UnstyledButton } from '@mantine/core';

import PreloadLink from '@components/utils/link';

export function Brand() {
  return (
    <Center mr="1rem" miw="12rem">
      <UnstyledButton component={PreloadLink} href="/">
        <Group>
          <Image
            style={{ width: '38px', marginRight: '0px' }}
            src="/favicon.svg"
            alt="Sealed League logo"
          />
          <Title style={{ height: '38px', marginBottom: '0.4rem' }}>Sealed League</Title>
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
          style={{ width: '32px', marginRight: '0px' }}
          src="/favicon.svg"
          alt="Sealed League logo"
        />
        <Text size="xl" ml="0.75rem">
          Sealed League
        </Text>
      </Center>
    </Center>
  );
}
